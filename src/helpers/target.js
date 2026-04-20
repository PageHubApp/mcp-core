const { apiFetch, normalizeBaseUrl } = require("../api-fetch");
const { getContext } = require("../context");
const { compressJsonToBase64Lz, tryDecompressBase64LzToJson } = require("../lz");

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
  // Explicit id → site
  if (args.id) return { type: "site", id: args.id };
  // Context: activeTemplate takes priority when set
  if (ctx.activeTemplate) return { type: "template", id: ctx.activeTemplate.slug };
  if (ctx.activeSite) return { type: "site", id: ctx.activeSite.id };
  throw new Error("No site or template selected. Run select_site or select_template first.");
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
  return `${base}/build/${siteId}`;
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
    return {
      targetId: target.id,
      targetType: target.type,
      flat: JSON.parse(JSON.stringify(ctx._pendingFlatMap)),
      data: { content: ctx._pendingFlatMap },
    };
  }

  if (target.type === "template") {
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`);
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
  const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`);
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
  const knownRevision =
    ctx?._targetRevisions && typeof ctx._targetRevisions === "object"
      ? ctx._targetRevisions[revisionKey]
      : null;
  const body =
    targetType === "template"
      ? { content: compressJsonToBase64Lz(flat), ...knownRevision, ...extra }
      : { content: flat, ...knownRevision, ...extra };

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
  return { id: put.id, url: getEditorUrl(put.id || targetId), type: "site" };
}

/** Backwards-compat alias. */
async function saveSite(siteId, flat, extra = {}) {
  return saveTarget(siteId, "site", flat, extra);
}

module.exports = {
  decodeContentOrThrow,
  getActiveTarget,
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
