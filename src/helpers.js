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

module.exports = { parseMaybeJson, applyNodePatches, normalizeNodePatchArgs };
