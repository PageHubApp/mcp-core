const { twMerge } = require("tailwind-merge");
const { guardRootCompanyPropsPatch } = require("./branding-guard");
const {
  compressJsonToBase64Lz,
  decompressBase64LzToJson,
  tryDecompressBase64LzToJson,
} = require("./lz");

/** Try to JSON.parse a string, return as-is if it fails or isn't a string. */
function parseMaybeJson(v) {
  if (v == null) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      // Attempt lightweight repairs for common model JSON mistakes:
      // 1. Swapped ]} → }] (model closes array before object)
      // 2. Trailing commas before } or ]
      const repaired = v
        .replace(/"\s*\]\s*\}/g, (m, offset) => {
          // Check if there's an unclosed { — the ] and } may be swapped
          const lastOpen = v.lastIndexOf("{", offset);
          const lastClose = v.lastIndexOf("}", offset);
          if (lastOpen > lastClose) {
            return '"}]';
          }
          return m;
        })
        .replace(/,\s*([}\]])/g, "$1");
      if (repaired !== v) {
        try {
          return JSON.parse(repaired);
        } catch {
          /* fall through */
        }
      }
      return v;
    }
  }
  return v;
}

/**
 * Merge singular + list MCP args into deduped trimmed strings (comma-split on strings).
 * @param {string|string[]|undefined|null} singular e.g. args.category
 * @param {string|string[]|undefined|null} listish e.g. args.categories
 * @returns {string[]}
 */
function mergeStrList(singular, listish) {
  const parts = [];
  const add = v => {
    if (v == null || v === "") return;
    if (Array.isArray(v)) {
      for (const x of v) add(x);
      return;
    }
    for (const piece of String(v).split(",")) {
      const t = piece.trim();
      if (t) parts.push(t);
    }
  };
  add(singular);
  add(listish);
  return [...new Set(parts)];
}

/**
 * Remove specific Tailwind classes from a className string.
 * Supports exact matches and prefix matches (e.g. "gap-" removes "gap-4", "md:gap-8").
 */
/** True if arrays contain the same node ids with the same multiplicities (order ignored). */
function isSameChildIdMultiset(prev, next) {
  const a = Array.isArray(prev) ? prev.map(String) : [];
  const b = Array.isArray(next) ? next.map(String) : [];
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function removeClasses(className, toRemove) {
  if (!className || !Array.isArray(toRemove) || toRemove.length === 0) return className;
  const parts = String(className).split(/\s+/).filter(Boolean);
  const filtered = parts.filter(cls => {
    // Strip responsive prefix for matching (e.g. "md:gap-4" → "gap-4")
    const bare = cls.replace(/^(sm:|md:|lg:|xl:|2xl:)/, "");
    for (const pattern of toRemove) {
      if (pattern === cls || pattern === bare) return false;
      // Prefix match: "gap-" removes "gap-4", "gap-8", etc.
      if (pattern.endsWith("-") && (bare.startsWith(pattern) || cls.startsWith(pattern)))
        return false;
    }
    return true;
  });
  return filtered.join(" ");
}

/** Shallow-merge patch objects into a flat node map entry. */
function applyNodePatches(flatMap, nodeId, patchArgs) {
  const { typePatch, propsPatch, classNamePatch, nodesPatch, unsetProps, unsetClasses } =
    patchArgs;
  if (!flatMap[nodeId]) {
    let hint = "";
    if (String(nodeId).startsWith("kit_")) {
      const similar = Object.keys(flatMap)
        .filter(k => k.startsWith("kit_"))
        .slice(0, 12);
      hint =
        similar.length > 0
          ? ` Known kit_* ids in this map start with: ${similar.join(", ")}. Use ids from the apply_kit_block tool reply, not get_component_schema.`
          : " Use node ids from the latest apply_kit_block tool reply (copy exactly).";
    } else if (String(nodeId).startsWith("lib_")) {
      hint =
        " Use node ids from list_block_nodes for this block slug (copy exactly). Ids are deterministic from the slug.";
    }
    throw new Error(`Node ${nodeId} not found.${hint}`);
  }
  const entry = flatMap[nodeId];
  const p = entry.props;
  if (p == null || typeof p !== "object" || Array.isArray(p)) {
    entry.props = {};
  }
  // typePatch — update component type and keep isCanvas aligned with container semantics
  const normalizedTypePatch = normalizeTypePatch(typePatch);
  if (normalizedTypePatch) {
    entry.type = { ...(entry.type || {}), resolvedName: normalizedTypePatch };
    entry.isCanvas = CANVAS_TYPE_PATCH_COMPONENTS.has(normalizedTypePatch);
    if (!Array.isArray(entry.nodes)) entry.nodes = [];
  }
  // className patch — merge Tailwind classes into props.className via twMerge
  if (classNamePatch) {
    const existing = flatMap[nodeId].props.className || "";
    flatMap[nodeId].props.className = twMerge(existing, classNamePatch);
  }
  // Remove specific classes from props.className
  if (Array.isArray(unsetClasses) && unsetClasses.length > 0) {
    flatMap[nodeId].props.className = removeClasses(
      flatMap[nodeId].props.className || "",
      unsetClasses
    );
  }
  // propsPatch — shallow merge non-class props (text, src, href, alt, style, animation, etc.)
  // Deep-merge `root` to preserve existing keys (animation, pattern, activeModifiers, etc.)
  // Guard: propsPatch must be an object, never a string. A string here means parseMaybeJson
  // failed to parse malformed model JSON — spreading a string scatters chars as numeric keys.
  if (propsPatch && typeof propsPatch === "string") {
    throw new Error(
      `propsPatch for node "${nodeId}" is a string (invalid JSON from model). ` +
        `propsPatch must be a JSON object, not a string. Raw value starts with: ${propsPatch.substring(0, 120)}…`
    );
  }
  // Sanitize tagName to prevent corrupted data from crashing createElement
  if (propsPatch && typeof propsPatch.tagName === "string") {
    const t = propsPatch.tagName.split(/[,\s]/)[0].toLowerCase();
    if (/^[a-z][a-z0-6]*$/.test(t)) propsPatch.tagName = t;
    else delete propsPatch.tagName;
  }
  if (propsPatch) {
    if (propsPatch.root && typeof propsPatch.root === "object") {
      flatMap[nodeId].props.root = { ...(flatMap[nodeId].props.root || {}), ...propsPatch.root };
      const { root: _, ...rest } = propsPatch;
      flatMap[nodeId].props = { ...flatMap[nodeId].props, ...rest };
    } else {
      flatMap[nodeId].props = { ...flatMap[nodeId].props, ...propsPatch };
    }
  }
  if (nodesPatch) {
    const prevNodes = flatMap[nodeId].nodes;
    if (!isSameChildIdMultiset(prevNodes, nodesPatch)) {
      const prevJson = JSON.stringify(prevNodes || []);
      const nextJson = JSON.stringify(nodesPatch);
      throw new Error(
        `nodesPatch must list the exact same child node ids as currently on "${nodeId}" (reorder only). ` +
          `Existing: ${prevJson}. Received: ${nextJson}. ` +
          `Do not use nodesPatch for design changes, "main areas", or partial lists — use classNamePatch and propsPatch. ` +
          `To add/remove sections use add_nodes / delete_node.`
      );
    }
    flatMap[nodeId].nodes = nodesPatch;
  }
  if (Array.isArray(unsetProps)) {
    for (const k of unsetProps) delete flatMap[nodeId].props[k];
  }
}

const PATCH_BODY_KEYS = [
  "typePatch",
  "propsPatch",
  "classNamePatch",
  "nodesPatch",
  "unsetProps",
  "unsetClasses",
];

/** Allowed top-level keys for patch_site_node. */
const PATCH_SITE_NODE_ARG_KEYS = new Set([
  "id",
  "slug",
  "nodeId",
  ...PATCH_BODY_KEYS,
  "name",
  "title",
  "description",
]);

/** Allowed keys for patch_block (block library slug + same patch fields as site nodes). */
const PATCH_BLOCK_NODE_ARG_KEYS = new Set(["slug", "nodeId", ...PATCH_BODY_KEYS]);

/** Allowed keys on each patch_site_bulk array element (no nested "patches"). */
const PATCH_BULK_ITEM_KEYS = new Set([
  "nodeId",
  ...PATCH_BODY_KEYS,
  "name",
  "title",
  "description",
  "id",
]);

/** Allowed keys on each patch_block_bulk array element. */
const PATCH_BLOCK_BULK_ITEM_KEYS = new Set(["nodeId", ...PATCH_BODY_KEYS]);

const UNSUPPORTED_PATCH_FIELD_HINTS = {
  children:
    'Field "children" is not supported. Patch each child node by its kit_* id (e.g. Button nodes under ButtonList) using propsPatch for text, icon, and root styles — copy ids from the apply_kit_block reply.',
};

const VALID_TYPE_PATCH_COMPONENTS = new Set([
  "Accordion",
  "Audio",
  "Automatic",
  "Background",
  "Button",
  "ButtonList",
  "CartBadge",
  "CartDrawer",
  "CartItems",
  "CartSubtotal",
  "CheckoutBanner",
  "Container",
  "ContainerGroup",
  "Data",
  "Divider",
  "Dropdown",
  "Embed",
  "Footer",
  "Form",
  "FormElement",
  "Grid",
  "Header",
  "Icon",
  "Image",
  "ImageList",
  "Link",
  "List",
  "ListItem",
  "Map",
  "MapPoint",
  "Modal",
  "Nav",
  "Spacer",
  "Table",
  "TableCell",
  "TableRow",
  "TableSection",
  "Tabs",
  "Text",
  "Video",
]);

const CANVAS_TYPE_PATCH_COMPONENTS = new Set([
  "Accordion",
  "Automatic",
  "Background",
  "CartDrawer",
  "CheckoutBanner",
  "Container",
  "ContainerGroup",
  "Data",
  "Dropdown",
  "Footer",
  "Form",
  "Grid",
  "Header",
  "List",
  "Modal",
  "Nav",
  "Table",
  "TableRow",
  "TableSection",
  "Tabs",
]);

function normalizeTypePatch(rawTypePatch) {
  if (rawTypePatch == null) return null;
  const typeName =
    typeof rawTypePatch === "string"
      ? rawTypePatch.trim()
      : typeof rawTypePatch === "object" && typeof rawTypePatch.resolvedName === "string"
        ? rawTypePatch.resolvedName.trim()
        : "";
  if (!typeName) {
    throw new Error(
      "typePatch must be a non-empty string (e.g. \"Button\") or object { resolvedName: \"Button\" }."
    );
  }
  if (!VALID_TYPE_PATCH_COMPONENTS.has(typeName)) {
    throw new Error(
      `typePatch "${typeName}" is not a supported component type. Allowed: ${[
        ...VALID_TYPE_PATCH_COMPONENTS,
      ].join(", ")}.`
    );
  }
  return typeName;
}

function assertPatchKeys(obj, allowedSet, label) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    if (allowedSet.has(k)) continue;
    const hint =
      UNSUPPORTED_PATCH_FIELD_HINTS[k] ||
      `Unknown field "${k}". Allowed: ${[...allowedSet].sort().join(", ")}.`;
    throw new Error(`${label}: ${hint}`);
  }
}

function assertPatchSiteNodeArgs(args) {
  assertPatchKeys(args, PATCH_SITE_NODE_ARG_KEYS, "patch_site_node");
}

function assertPatchBulkItem(item, index) {
  assertPatchKeys(item, PATCH_BULK_ITEM_KEYS, `patch_site_bulk patches[${index}]`);
}

function assertPatchBlockNodeArgs(args) {
  assertPatchKeys(args, PATCH_BLOCK_NODE_ARG_KEYS, "patch_block");
}

function assertPatchBlockBulkItem(item, index) {
  assertPatchKeys(item, PATCH_BLOCK_BULK_ITEM_KEYS, `patch_block_bulk patches[${index}]`);
}

/** Normalize raw patch args (parse JSON strings). */
function normalizeNodePatchArgs(raw) {
  return {
    typePatch: parseMaybeJson(raw.typePatch) ?? raw.typePatch,
    propsPatch: parseMaybeJson(raw.propsPatch) ?? raw.propsPatch,
    classNamePatch: typeof raw.classNamePatch === "string" ? raw.classNamePatch : undefined,
    nodesPatch: raw.nodesPatch,
    unsetProps: raw.unsetProps,
    unsetClasses: raw.unsetClasses,
  };
}

/**
 * Parse patches JSON string; tolerate markdown fences and trailing commas (common model mistakes).
 */
function parseBulkPatchesJsonString(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  if (!trimmed) return null;
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const smartQuotes = unfenced.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const variants = [unfenced, smartQuotes];
  const attempts = [];
  for (const v of variants) {
    attempts.push(v, v.replace(/,\s*([\]}])/g, "$1"));
    // Also try repairing swapped ]} → }] (common model mistake)
    const repaired = v.replace(/"\s*\]\s*\}/g, (m, offset) => {
      const lastOpen = v.lastIndexOf("{", offset);
      const lastClose = v.lastIndexOf("}", offset);
      if (lastOpen > lastClose) return '"}]';
      return m;
    });
    if (repaired !== v) {
      attempts.push(repaired, repaired.replace(/,\s*([\]}])/g, "$1"));
    }
  }
  for (const s of attempts) {
    try {
      return JSON.parse(s);
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Split `[a,b,c]` inner by commas at depth 0 (respects strings). */
function splitTopLevelCommaSeparatedJsonValues(inner) {
  const segs = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let esc = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inString) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    if (c === "," && depth === 0) {
      segs.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  segs.push(inner.slice(start).trim());
  return segs.filter(x => x.length > 0);
}

/**
 * When the full array string fails JSON.parse, try parsing each `{...}` segment (models often break only one object).
 */
function tryParseBulkPatchArrayElementsFromString(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  if (!unfenced.startsWith("[") || !unfenced.endsWith("]")) return null;
  const inner = unfenced.slice(1, -1).trim();
  if (!inner) return [];
  const segs = splitTopLevelCommaSeparatedJsonValues(inner);
  const out = [];
  for (const seg of segs) {
    const frag = seg.trim();
    if (!frag.startsWith("{")) return null;
    let parsed;
    try {
      parsed = JSON.parse(frag);
    } catch {
      try {
        parsed = JSON.parse(frag.replace(/,\s*}$/, "}"));
      } catch {
        return null;
      }
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.nodeId !== "string") return null;
    out.push(parsed);
  }
  return out.length > 0 ? out : null;
}

/**
 * Coerce patch_site_bulk input from common model mistakes into an array of patch objects.
 * Handles: JSON string, single { nodeId, ... }, { patches: [...] }, array-like { "0": {...} }.
 */
function normalizeBulkPatchesFromArgs(args = {}) {
  let list = args.patches != null ? args.patches : args.patch;
  let safety = 0;
  while (list != null && safety++ < 10) {
    if (typeof list === "string") {
      const trimmed = list.trim();
      if (!trimmed) return null;
      let next = parseMaybeJson(trimmed);
      if (next === list) {
        next = parseBulkPatchesJsonString(trimmed);
      }
      if (next == null || next === list) {
        next = tryParseBulkPatchArrayElementsFromString(trimmed);
      }
      if (next == null || next === list) return null;
      list = next;
      continue;
    }
    if (Array.isArray(list)) {
      return list.filter(x => x != null && typeof x === "object");
    }
    if (typeof list === "object") {
      if (typeof list.nodeId === "string") {
        return [list];
      }
      if (Array.isArray(list.patches)) {
        list = list.patches;
        continue;
      }
      const keys = Object.keys(list);
      if (keys.length && keys.every(k => /^\d+$/.test(k))) {
        return keys
          .sort((a, b) => Number(a) - Number(b))
          .map(k => list[k])
          .filter(x => x != null && typeof x === "object");
      }
      return null;
    }
    return null;
  }
  return null;
}

function decodeContentOrThrow(content, label = "content") {
  const decoded = tryDecompressBase64LzToJson(content);
  if (!decoded || typeof decoded !== "object") {
    throw new Error(`${label} must be an lzutf8+base64 compressed JSON string.`);
  }
  return decoded;
}

// ── Target (site OR template) fetch/save helpers ──

const { apiFetch } = require("./api-fetch");
const { getContext } = require("./context");
const { normalizeBaseUrl } = require("./api-fetch");

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

// ── Image URL validation ──

function extractImageUrls(props, resolvedName) {
  const urls = [];
  if (!props) return urls;
  const imgSrc = resolvedName === "Image" ? (props.src ?? props.content) : null;
  if (imgSrc && typeof imgSrc === "string") {
    if (props.type === "url" || (!props.type && imgSrc.startsWith("http"))) {
      urls.push(imgSrc);
    }
  }
  if (
    props.backgroundImage &&
    typeof props.backgroundImage === "string" &&
    props.backgroundImage.startsWith("http")
  ) {
    urls.push(props.backgroundImage);
  }
  return urls;
}

async function validateImageUrls(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (!resp.ok) failures.push({ url, status: resp.status });
    } catch (e) {
      failures.push({ url, status: `error: ${e.message}` });
    }
  }
  return failures;
}

function collectAllImageUrls(nodes) {
  const urls = [];
  for (const [id, node] of Object.entries(nodes)) {
    const found = extractImageUrls(node.props, node.type?.resolvedName);
    for (const url of found) urls.push({ nodeId: id, url });
  }
  return urls;
}

/** All node ids in the subtree rooted at rootId (includes rootId). */
function collectSubtreeNodeIds(flat, rootId) {
  const ids = new Set();
  const walk = id => {
    if (!id || !flat[id] || ids.has(id)) return;
    ids.add(id);
    for (const c of flat[id].nodes || []) walk(c);
  };
  walk(rootId);
  return ids;
}

/**
 * Footer parallel fills use sectionNodeId "sec_footer" for bookkeeping, but apply_kit_block(target:"footer")
 * installs kit nodes under ftr_root — patch allowlist must follow that subtree.
 */
function getFillModePatchSubtreeRootId(flat, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId) return null;
  if (ctx.footerFill && flat?.ftr_root) return "ftr_root";
  return String(ctx.sectionNodeId);
}

/** Parallel section fills may only patch nodes inside the assigned section canvas. */
function assertFillModePatchAllowed(flat, nodeId, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId) return;
  const rootId = getFillModePatchSubtreeRootId(flat, ctx);
  if (!rootId || !flat[rootId]) return;
  const allowed = collectSubtreeNodeIds(flat, rootId);
  if (!allowed.has(nodeId)) {
    const label = ctx.footerFill && rootId === "ftr_root" ? "footer (ftr_root)" : rootId;
    throw new Error(
      `Parallel fill: cannot edit node "${nodeId}" — only nodes inside your section "${label}" are editable. Do not patch other sections.`
    );
  }
}

/**
 * Fill mode: validate every patch target before applying any (avoids partial applies + clearer errors when one bulk mixes sec_*).
 */
function assertFillModeBulkPatchesAllowed(flat, patchList, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId || !Array.isArray(patchList)) return;
  const rootId = getFillModePatchSubtreeRootId(flat, ctx);
  if (!rootId || !flat[rootId]) return;
  const allowed = collectSubtreeNodeIds(flat, rootId);
  const bad = [];
  for (const item of patchList) {
    const nid = item?.nodeId;
    if (typeof nid !== "string") continue;
    if (!allowed.has(nid)) bad.push(nid);
  }
  if (bad.length === 0) return;
  const uniq = [...new Set(bad)];
  const secLabel = ctx.footerFill && rootId === "ftr_root" ? "footer (ftr_root)" : rootId;
  throw new Error(
    `Parallel fill: patch_site_bulk lists node(s) outside your section "${secLabel}": ${uniq.join(", ")}. ` +
      `Remove those entries — only kit_* ids from your apply_kit_block reply under "${secLabel}". Never include sibling sec_* containers (e.g. sec_hero fill must not patch sec_features).`
  );
}

module.exports = {
  parseMaybeJson,
  mergeStrList,
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  compressJsonToBase64Lz,
  decompressBase64LzToJson,
  decodeContentOrThrow,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
  getActiveTarget,
  getActiveSiteId,
  isTemplateTarget,
  getEditorUrl,
  fetchTarget,
  fetchSite,
  saveTarget,
  saveSite,
  extractImageUrls,
  validateImageUrls,
  collectAllImageUrls,
  collectSubtreeNodeIds,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
  guardRootCompanyPropsPatch,
};
