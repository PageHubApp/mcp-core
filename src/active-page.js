/**
 * True if flat[id] is a page-type node.
 * @param {Record<string,any>} flat
 * @param {string} id
 */
function isPageNode(flat, id) {
  return flat[id]?.props?.type === 'page';
}

/**
 * Resolve the default page node id for a tool call.
 * Priority: explicit arg > editor context (activePageNodeId) > 'page_home' (if it exists) > null.
 *
 * @param {{ flat: Record<string,any>, ctx: object, explicitPageId?: string }} opts
 * @returns {string|null}
 */
function resolveToolDefaultPageNodeId({ flat, ctx, explicitPageId }) {
  if (explicitPageId) return explicitPageId;
  if (!ctx.fillMode && ctx.activePageNodeId && isPageNode(flat, ctx.activePageNodeId)) {
    return ctx.activePageNodeId;
  }
  return isPageNode(flat, 'page_home') ? 'page_home' : null;
}

module.exports = { isPageNode, resolveToolDefaultPageNodeId };
