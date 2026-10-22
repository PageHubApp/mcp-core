const { apiFetch, normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { compressJsonToBase64Lz, tryDecompressBase64LzToJson } = require("../codec/lz");
const { siteIsHtmlError } = require("../data/site-formats");

function decodeContentOrThrow(content, label = "content") {
  const decoded = tryDecompressBase64LzToJson(content);
  if (!decoded || typeof decoded !== "object") {
    throw new Error(`${label} must be an lzutf8+base64 compressed JSON string.`);
  }
  return decoded;
}

/**
 * Resolve the active target — either a site or template.
 * Priority: explicit args > activeTemplate > activeSite.
 * Returns { type: 'site'|'template', id: string }
 */
function getActiveTarget(args = {}) {
  const ctx = getContext();
  // Explicit slug → template
  if (args.slug && !args.id) return { type: "template", id: args.slug };
  // Explicit id → site. The AI client is pinned to the chat's site: an id the
  // model picked up from history or pasted text must not reach another site
  // the user is also a member of (its draft would then be saved into this one).
  if (args.id) {
    if (ctx.client === "ai" && ctx.activeSite?.id && args.id !== ctx.activeSite.id) {
      throw new Error(
        `This chat works on site ${ctx.activeSite.id}; it can't touch ${args.id}. Switch to that site in the dashboard first.`
      );
    }
    return { type: "site", id: args.id };
  }
  // Context: activeTemplate takes priority when set
  if (ctx.activeTemplate) return { type: "template", id: ctx.activeTemplate.slug };
  if (ctx.activeSite) return { type: "site", id: ctx.activeSite.id };
  if (ctx.stateless) {
    throw new Error(
      "No site given. Pass the site `id` (or a template `slug`) on this call — this server doesn't remember select_site between calls."
    );
  }
  throw new Error("No site or template selected. Run select_site or select_template first.");
}

/**
 * Trailer for tools that set the active target. On a stateless server
 * (`ctx.stateless`, the hosted HTTP endpoint) the selection only lasts for the
 * call that made it, so the agent has to carry the id itself.
 * @param {{ type: 'site'|'template', id: string }} target
 */
function selectionNote(target) {
  if (!getContext().stateless) return "";
  const arg = target.type === "template" ? `slug: "${target.id}"` : `id: "${target.id}"`;
  return `\nPass ${arg} on every later call — this server doesn't remember the selection between calls.`;
}

/** Backwards-compat: returns the site id or template slug. */
function getActiveSiteId(args) {
  return getActiveTarget(args).id;
}

function isTemplateTarget(args) {
  try {
    return getActiveTarget(args).type === "template";
  } catch {
    return false;
  }
}

function getEditorUrl(siteId) {
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
  return `${base}/dashboard/sites/${siteId}/design`;
}

function getTargetRevisionKey(targetType, targetId) {
  return `${String(targetType)}:${String(targetId)}`;
}

function extractTargetRevision(targetType, data) {
  if (!data || typeof data !== "object") return null;
  if (targetType === "template") {
    const version = Number(data.version);
    return Number.isFinite(version) ? { expectedVersion: version } : null;
  }
  if (targetType === "site") {
    if (data.updatedAt) return { expectedUpdatedAt: String(data.updatedAt) };
    return null;
  }
  return null;
}

/**
 * Fetch content for the active target (site or template).
 * Checks ctx._pendingFlatMap first (draft/fill mode), then fetches from API.
 * Always returns a deep clone in `flat` — callers can mutate freely.
 * Returns { targetId, targetType, flat, data }.
 */
async function fetchTarget(args) {
  const target = getActiveTarget(args);
  const ctx = getContext();

  // Draft/fill mode: use pending flat map if available
  if (ctx._pendingFlatMap && typeof ctx._pendingFlatMap === "object") {
    if (process.env.DEBUG_SLOT_KITS === "1") {
      const m = ctx._pendingFlatMap;
      const hdrNodes = m.hdr_root?.nodes || [];
      const ftrNodes = m.ftr_root?.nodes || [];
      const kitHdr = Object.keys(m).filter(
        k => k.startsWith("kit_") && m[k]?.parent === "hdr_root"
      ).length;
      const kitFtr = Object.keys(m).filter(
        k => k.startsWith("kit_") && m[k]?.parent === "ftr_root"
      ).length;
      const totalKits = Object.keys(m).filter(k => k.startsWith("kit_")).length;
      console.log(
        `[slot-kits] fetchTarget BEFORE: hdr_root.nodes=${JSON.stringify(hdrNodes)} (kits under hdr_root=${kitHdr}) | ftr_root.nodes=${JSON.stringify(ftrNodes)} (kits under ftr_root=${kitFtr}) | totalKitsInMap=${totalKits}`
      );
    }
    return {
      targetId: target.id,
      targetType: target.type,
      flat: JSON.parse(JSON.stringify(ctx._pendingFlatMap)),
      data: { content: ctx._pendingFlatMap },
    };
  }

  if (target.type === "template") {
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`);
    // A template stored as HTML has no node tree: read it with pull_template({ slug, format: "liquid" }).
    if (data.format === "html") {
      throw new Error(`Template "${target.id}" is HTML + Liquid files with no node tree. Read it with pull_template({ slug: "${target.id}", format: "liquid" }); node tools do not apply.`);
    }
    const decodedContent = decodeContentOrThrow(data.content, "Template content");
    const revision = extractTargetRevision(target.type, data);
    if (revision) {
      if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
        ctx._targetRevisions = {};
      ctx._targetRevisions[getTargetRevisionKey(target.type, target.id)] = revision;
    }
    return {
      targetId: target.id,
      targetType: "template",
      flat: JSON.parse(JSON.stringify(decodedContent)),
      data,
    };
  }
  // Always read the latest WIP. Draft-only saves (the editor's Accept path)
  // don't update sharedContent, so defaulting to content gives the agent
  // stale state and the next turn silently rebuilds from scratch.
  const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}?field=draft`);
  // An HTML-first site has files, not a node tree: every node-tree tool lands here and refuses with guidance.
  if (data.format === "html") throw siteIsHtmlError(target.id);
  if (!data.content || typeof data.content !== "object") {
    throw new Error("Site has no decoded content (empty or corrupt).");
  }
  const revision = extractTargetRevision(target.type, data);
  if (revision) {
    if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
      ctx._targetRevisions = {};
    ctx._targetRevisions[getTargetRevisionKey(target.type, target.id)] = revision;
  }
  return {
    targetId: target.id,
    targetType: "site",
    flat: JSON.parse(JSON.stringify(data.content)),
    data,
  };
}

/** Backwards-compat alias. */
async function fetchSite(args) {
  const result = await fetchTarget(args);
  return { siteId: result.targetId, flat: result.flat, data: result.data };
}

/**
 * Save content for the active target (site or template).
 */
async function saveTarget(targetId, targetType, flat, extra = {}) {
  const ctx = getContext();
  const revisionKey = getTargetRevisionKey(targetType, targetId);
  // MCP/agent writes intentionally skip optimistic concurrency — the AI agent
  // does rapid back-to-back writes in a single turn and surfacing STALE_REVISION
  // to the model led to strategy pivots (delete → reapply_kit_block loops) and
  // silent failure. Last-write-wins is fine for AI edits; editor UI still sends
  // expectedUpdatedAt on its own paths.
  // Compressed for both targets: a raw flat map of a large site exceeds the
  // route's request body limit long before the site itself is too big.
  const body = { content: compressJsonToBase64Lz(flat), ...extra };

  if (targetType === "template") {
    const put = await apiFetch(`/api/v1/templates/${encodeURIComponent(targetId)}`, {
      method: "PUT",
      body,
    });
    const freshRevision = extractTargetRevision(targetType, put);
    if (freshRevision) {
      if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
        ctx._targetRevisions = {};
      ctx._targetRevisions[revisionKey] = freshRevision;
    }
    return { id: put.slug || targetId, url: null, type: "template" };
  }
  const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(targetId)}`, {
    method: "PUT",
    body,
  });
  const freshRevision = extractTargetRevision(targetType, put);
  if (freshRevision) {
    if (!ctx._targetRevisions || typeof ctx._targetRevisions !== "object")
      ctx._targetRevisions = {};
    ctx._targetRevisions[revisionKey] = freshRevision;
  }
  // Site writes STAGE into the draft; `publish_site` promotes. Record it so
  // `resultMsg` can say so on every tool's output — an agent that believes it
  // already published will not run the step that actually does.
  const saved = {
    id: put.id || targetId,
    url: getEditorUrl(put.id || targetId),
    type: "site",
    wroteTo: put.wroteTo || "draft",
    hasUnpublishedChanges: !!put.hasUnpublishedChanges,
  };
  // `executeTool` reads this after the handler returns and appends the
  // publish-state trailer, so a tool that builds its own message — most of
  // them do — cannot ship without it.
  ctx._lastSiteWrite = {
    id: saved.id,
    wroteTo: saved.wroteTo,
    published: !!put.published,
    hasUnpublishedChanges: saved.hasUnpublishedChanges,
    unpublishedPages: Array.isArray(put.unpublishedPages) ? put.unpublishedPages : [],
    lastPublishedAt: put.lastPublishedAt || null,
  };
  return saved;
}

/** Backwards-compat alias. */
async function saveSite(siteId, flat, extra = {}) {
  return saveTarget(siteId, "site", flat, extra);
}

module.exports = {
  decodeContentOrThrow,
  getActiveTarget,
  selectionNote,
  getActiveSiteId,
  isTemplateTarget,
  getEditorUrl,
  getTargetRevisionKey,
  extractTargetRevision,
  fetchTarget,
  fetchSite,
  saveTarget,
  saveSite,
};
