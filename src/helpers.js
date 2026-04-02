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
    propsPatch, mobilePatch, rootPatch, nodesPatch,
    unsetProps, unsetMobile, unsetRoot,
  } = patchArgs;
  if (!flatMap[nodeId]) throw new Error(`Node ${nodeId} not found`);
  if (propsPatch) flatMap[nodeId].props = { ...flatMap[nodeId].props, ...propsPatch };
  if (mobilePatch) {
    flatMap[nodeId].props.mobile = { ...(flatMap[nodeId].props.mobile || {}), ...mobilePatch };
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
  if (Array.isArray(unsetRoot)) {
    const r = flatMap[nodeId].props.root || {};
    for (const k of unsetRoot) delete r[k];
    flatMap[nodeId].props.root = r;
  }
}

/** Normalize raw patch args (parse JSON strings). */
function normalizeNodePatchArgs(raw) {
  return {
    propsPatch: parseMaybeJson(raw.propsPatch) ?? raw.propsPatch,
    mobilePatch: parseMaybeJson(raw.mobilePatch) ?? raw.mobilePatch,
    rootPatch: parseMaybeJson(raw.rootPatch) ?? raw.rootPatch,
    nodesPatch: raw.nodesPatch,
    unsetProps: raw.unsetProps,
    unsetMobile: raw.unsetMobile,
    unsetRoot: raw.unsetRoot,
  };
}

// ── Site fetch/save helpers ──

const { apiFetch } = require('./api-fetch');
const { getContext } = require('./context');
const { normalizeBaseUrl } = require('./api-fetch');

function getActiveSiteId(args) {
  const ctx = getContext();
  const id = args.id || ctx.activeSite?.id;
  if (!id) throw new Error('No site id provided and no active site set. Run select_site first.');
  return id;
}

function getEditorUrl(siteId) {
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
  return `${base}/build/${siteId}`;
}

async function fetchSite(args) {
  const siteId = getActiveSiteId(args);
  const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
  if (!data.content || typeof data.content !== 'object') {
    throw new Error('Site has no decoded content (empty or corrupt).');
  }
  return { siteId, flat: JSON.parse(JSON.stringify(data.content)), data };
}

async function saveSite(siteId, flat, extra = {}) {
  const body = { content: flat, ...extra };
  const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, { method: 'PUT', body });
  return { id: put.id, url: getEditorUrl(put.id || siteId) };
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

module.exports = {
  parseMaybeJson, applyNodePatches, normalizeNodePatchArgs,
  getActiveSiteId, getEditorUrl, fetchSite, saveSite,
  extractImageUrls, validateImageUrls, collectAllImageUrls,
};
