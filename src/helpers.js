/** Try to JSON.parse a string, return as-is if it fails or isn't a string. */
function parseMaybeJson(v) {
  if (v == null) return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

/** Shallow-merge patch objects into a flat node map entry. */
function applyNodePatches(flatMap, nodeId, patchArgs) {
  const {
    propsPatch, mobilePatch, desktopPatch, rootPatch, nodesPatch,
    unsetProps, unsetMobile, unsetDesktop, unsetRoot,
  } = patchArgs;
    if (!flatMap[nodeId]) {
    let hint = '';
    if (String(nodeId).startsWith('kit_')) {
      const similar = Object.keys(flatMap).filter((k) => k.startsWith('kit_')).slice(0, 12);
      hint =
        similar.length > 0
          ? ` Known kit_* ids in this map start with: ${similar.join(', ')}. Use ids from the apply_kit_block tool reply, not get_component_schema.`
          : ' Use node ids from the latest apply_kit_block tool reply (copy exactly).';
    } else if (String(nodeId).startsWith('lib_')) {
      hint =
        ' Use node ids from list_block_nodes for this block slug (copy exactly). Ids are deterministic from the slug.';
    }
    throw new Error(`Node ${nodeId} not found.${hint}`);
  }
  if (propsPatch) flatMap[nodeId].props = { ...flatMap[nodeId].props, ...propsPatch };
  if (mobilePatch) {
    flatMap[nodeId].props.mobile = { ...(flatMap[nodeId].props.mobile || {}), ...mobilePatch };
  }
  if (desktopPatch) {
    flatMap[nodeId].props.desktop = { ...(flatMap[nodeId].props.desktop || {}), ...desktopPatch };
  }
  if (rootPatch) {
    flatMap[nodeId].props.root = { ...(flatMap[nodeId].props.root || {}), ...rootPatch };
  }
  if (nodesPatch) flatMap[nodeId].nodes = nodesPatch;
  if (Array.isArray(unsetProps)) {
    for (const k of unsetProps) delete flatMap[nodeId].props[k];
  }
  if (Array.isArray(unsetMobile)) {
    const m = flatMap[nodeId].props.mobile || {};
    for (const k of unsetMobile) delete m[k];
    flatMap[nodeId].props.mobile = m;
  }
  if (Array.isArray(unsetDesktop)) {
    const d = flatMap[nodeId].props.desktop || {};
    for (const k of unsetDesktop) delete d[k];
    flatMap[nodeId].props.desktop = d;
  }
  if (Array.isArray(unsetRoot)) {
    const r = flatMap[nodeId].props.root || {};
    for (const k of unsetRoot) delete r[k];
    flatMap[nodeId].props.root = r;
  }
}

const PATCH_BODY_KEYS = [
  'propsPatch',
  'mobilePatch',
  'desktopPatch',
  'rootPatch',
  'nodesPatch',
  'unsetProps',
  'unsetMobile',
  'unsetDesktop',
  'unsetRoot',
];

/** Allowed top-level keys for patch_site_node. */
const PATCH_SITE_NODE_ARG_KEYS = new Set(['id', 'slug', 'nodeId', ...PATCH_BODY_KEYS, 'name', 'title', 'description']);

/** Allowed keys for patch_block (block library slug + same patch fields as site nodes). */
const PATCH_BLOCK_NODE_ARG_KEYS = new Set(['slug', 'nodeId', ...PATCH_BODY_KEYS]);

/** Allowed keys on each patch_site_bulk array element (no nested "patches"). */
const PATCH_BULK_ITEM_KEYS = new Set(['nodeId', ...PATCH_BODY_KEYS, 'name', 'title', 'description', 'id']);

/** Allowed keys on each patch_block_bulk array element. */
const PATCH_BLOCK_BULK_ITEM_KEYS = new Set(['nodeId', ...PATCH_BODY_KEYS]);

const UNSUPPORTED_PATCH_FIELD_HINTS = {
  children:
    'Field "children" is not supported. Patch each child node by its kit_* id (e.g. Button nodes under ButtonList) using propsPatch for text, icon, and root styles — copy ids from the apply_kit_block reply.',
};

function assertPatchKeys(obj, allowedSet, label) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (allowedSet.has(k)) continue;
    const hint =
      UNSUPPORTED_PATCH_FIELD_HINTS[k] ||
      `Unknown field "${k}". Allowed: ${[...allowedSet].sort().join(', ')}.`;
    throw new Error(`${label}: ${hint}`);
  }
}

function assertPatchSiteNodeArgs(args) {
  assertPatchKeys(args, PATCH_SITE_NODE_ARG_KEYS, 'patch_site_node');
}

function assertPatchBulkItem(item, index) {
  assertPatchKeys(item, PATCH_BULK_ITEM_KEYS, `patch_site_bulk patches[${index}]`);
}

function assertPatchBlockNodeArgs(args) {
  assertPatchKeys(args, PATCH_BLOCK_NODE_ARG_KEYS, 'patch_block');
}

function assertPatchBlockBulkItem(item, index) {
  assertPatchKeys(item, PATCH_BLOCK_BULK_ITEM_KEYS, `patch_block_bulk patches[${index}]`);
}

/** Normalize raw patch args (parse JSON strings). */
function normalizeNodePatchArgs(raw) {
  return {
    propsPatch: parseMaybeJson(raw.propsPatch) ?? raw.propsPatch,
    mobilePatch: parseMaybeJson(raw.mobilePatch) ?? raw.mobilePatch,
    desktopPatch: parseMaybeJson(raw.desktopPatch) ?? raw.desktopPatch,
    rootPatch: parseMaybeJson(raw.rootPatch) ?? raw.rootPatch,
    nodesPatch: raw.nodesPatch,
    unsetProps: raw.unsetProps,
    unsetMobile: raw.unsetMobile,
    unsetDesktop: raw.unsetDesktop,
    unsetRoot: raw.unsetRoot,
  };
}

/**
 * Parse patches JSON string; tolerate markdown fences and trailing commas (common model mistakes).
 */
function parseBulkPatchesJsonString(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, '');
  if (!trimmed) return null;
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const smartQuotes = unfenced
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  const variants = [unfenced, smartQuotes];
  const attempts = [];
  for (const v of variants) {
    attempts.push(v, v.replace(/,\s*([\]}])/g, '$1'));
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
      else if (c === '\\') esc = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      segs.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  segs.push(inner.slice(start).trim());
  return segs.filter((x) => x.length > 0);
}

/**
 * When the full array string fails JSON.parse, try parsing each `{...}` segment (models often break only one object).
 */
function tryParseBulkPatchArrayElementsFromString(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, '');
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (!unfenced.startsWith('[') || !unfenced.endsWith(']')) return null;
  const inner = unfenced.slice(1, -1).trim();
  if (!inner) return [];
  const segs = splitTopLevelCommaSeparatedJsonValues(inner);
  const out = [];
  for (const seg of segs) {
    const frag = seg.trim();
    if (!frag.startsWith('{')) return null;
    let parsed;
    try {
      parsed = JSON.parse(frag);
    } catch {
      try {
        parsed = JSON.parse(frag.replace(/,\s*}$/, '}'));
      } catch {
        return null;
      }
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.nodeId !== 'string') return null;
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
    if (typeof list === 'string') {
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
      return list.filter((x) => x != null && typeof x === 'object');
    }
    if (typeof list === 'object') {
      if (typeof list.nodeId === 'string') {
        return [list];
      }
      if (Array.isArray(list.patches)) {
        list = list.patches;
        continue;
      }
      const keys = Object.keys(list);
      if (keys.length && keys.every((k) => /^\d+$/.test(k))) {
        return keys
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => list[k])
          .filter((x) => x != null && typeof x === 'object');
      }
      return null;
    }
    return null;
  }
  return null;
}

// ── Target (site OR template) fetch/save helpers ──

const { apiFetch } = require('./api-fetch');
const { getContext } = require('./context');
const { normalizeBaseUrl } = require('./api-fetch');

/**
 * Resolve the active target — either a site or template.
 * Priority: explicit args > activeTemplate > activeSite.
 * Returns { type: 'site'|'template', id: string }
 */
function getActiveTarget(args = {}) {
  const ctx = getContext();
  // Explicit slug → template
  if (args.slug && !args.id) return { type: 'template', id: args.slug };
  // Explicit id → site
  if (args.id) return { type: 'site', id: args.id };
  // Context: activeTemplate takes priority when set
  if (ctx.activeTemplate) return { type: 'template', id: ctx.activeTemplate.slug };
  if (ctx.activeSite) return { type: 'site', id: ctx.activeSite.id };
  throw new Error('No site or template selected. Run select_site or select_template first.');
}

/** Backwards-compat: returns the site id or template slug. */
function getActiveSiteId(args) {
  return getActiveTarget(args).id;
}

function isTemplateTarget(args) {
  try { return getActiveTarget(args).type === 'template'; } catch { return false; }
}

function getEditorUrl(siteId) {
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
  return `${base}/build/${siteId}`;
}

/**
 * Fetch content for the active target (site or template).
 * Returns { targetId, targetType, flat, data }.
 */
async function fetchTarget(args) {
  const target = getActiveTarget(args);
  if (target.type === 'template') {
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`);
    if (!data.content || typeof data.content !== 'object') {
      throw new Error('Template has no decoded content (empty or corrupt).');
    }
    return { targetId: target.id, targetType: 'template', flat: JSON.parse(JSON.stringify(data.content)), data };
  }
  const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`);
  if (!data.content || typeof data.content !== 'object') {
    throw new Error('Site has no decoded content (empty or corrupt).');
  }
  return { targetId: target.id, targetType: 'site', flat: JSON.parse(JSON.stringify(data.content)), data };
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
  if (targetType === 'template') {
    const body = { content: flat, ...extra };
    const put = await apiFetch(`/api/v1/templates/${encodeURIComponent(targetId)}`, { method: 'PUT', body });
    return { id: put.slug || targetId, url: null, type: 'template' };
  }
  const body = { content: flat, ...extra };
  const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(targetId)}`, { method: 'PUT', body });
  return { id: put.id, url: getEditorUrl(put.id || targetId), type: 'site' };
}

/** Backwards-compat alias. */
async function saveSite(siteId, flat, extra = {}) {
  return saveTarget(siteId, 'site', flat, extra);
}

// ── Image URL validation ──

function extractImageUrls(props, resolvedName) {
  const urls = [];
  if (!props) return urls;
  if (resolvedName === 'Image' && props.content && typeof props.content === 'string') {
    if (props.type === 'url' || (!props.type && props.content.startsWith('http'))) {
      urls.push(props.content);
    }
  }
  if (props.backgroundImage && typeof props.backgroundImage === 'string' && props.backgroundImage.startsWith('http')) {
    urls.push(props.backgroundImage);
  }
  return urls;
}

async function validateImageUrls(urls) {
  const failures = [];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
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
  const walk = (id) => {
    if (!id || !flat[id] || ids.has(id)) return;
    ids.add(id);
    for (const c of flat[id].nodes || []) walk(c);
  };
  walk(rootId);
  return ids;
}

/** Parallel section fills may only patch nodes inside the assigned section canvas. */
function assertFillModePatchAllowed(flat, nodeId, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId) return;
  const sec = String(ctx.sectionNodeId);
  if (!flat[sec]) return;
  const allowed = collectSubtreeNodeIds(flat, sec);
  if (!allowed.has(nodeId)) {
    throw new Error(
      `Parallel fill: cannot edit node "${nodeId}" — only nodes inside your section "${sec}" are editable. Do not patch other sections.`
    );
  }
}

/**
 * Fill mode: validate every patch target before applying any (avoids partial applies + clearer errors when one bulk mixes sec_*).
 */
function assertFillModeBulkPatchesAllowed(flat, patchList, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId || !Array.isArray(patchList)) return;
  const sec = String(ctx.sectionNodeId);
  if (!flat[sec]) return;
  const allowed = collectSubtreeNodeIds(flat, sec);
  const bad = [];
  for (const item of patchList) {
    const nid = item?.nodeId;
    if (typeof nid !== 'string') continue;
    if (!allowed.has(nid)) bad.push(nid);
  }
  if (bad.length === 0) return;
  const uniq = [...new Set(bad)];
  throw new Error(
    `Parallel fill: patch_site_bulk lists node(s) outside your section "${sec}": ${uniq.join(', ')}. ` +
      `Remove those entries — only kit_* ids from your apply_kit_block reply under "${sec}". Never include sibling sec_* containers (e.g. sec_hero fill must not patch sec_features).`
  );
}

module.exports = {
  parseMaybeJson,
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
  getActiveTarget, getActiveSiteId, isTemplateTarget,
  getEditorUrl, fetchTarget, fetchSite, saveTarget, saveSite,
  extractImageUrls, validateImageUrls, collectAllImageUrls,
  collectSubtreeNodeIds, assertFillModePatchAllowed, assertFillModeBulkPatchesAllowed,
};
