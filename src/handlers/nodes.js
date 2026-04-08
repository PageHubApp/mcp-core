const {
  parseMaybeJson, applyNodePatches,
  fetchTarget, saveTarget,
  extractImageUrls, validateImageUrls,
} = require('../helpers');
const { getContext } = require('../context');

const PROTECTED_IDS = ['ROOT', 'page_home'];

module.exports = {
  async update_node(args) {
    const { nodeId, ...patches } = args;
    const { targetId, targetType, flat } = await fetchTarget(args);
    const patchedProps = patches.propsPatch ? parseMaybeJson(patches.propsPatch) : {};
    const imgUrls = [];
    if (patchedProps?.content && typeof patchedProps.content === 'string' && patchedProps.content.startsWith('http')) {
      imgUrls.push(patchedProps.content);
    }
    if (patchedProps?.backgroundImage && typeof patchedProps.backgroundImage === 'string' && patchedProps.backgroundImage.startsWith('http')) {
      imgUrls.push(patchedProps.backgroundImage);
    }
    if (imgUrls.length > 0) {
      const failures = await validateImageUrls(imgUrls);
      if (failures.length > 0) {
        const msg = failures.map(f => `  ${f.url} → ${f.status}`).join('\n');
        throw new Error(`Image validation failed — these URLs are broken:\n${msg}\n\nFix the URLs and try again.`);
      }
    }
    applyNodePatches(flat, nodeId, patches);
    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template'
      ? `Node ${nodeId} updated in template "${targetId}".`
      : `Node ${nodeId} updated.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async delete_node(args) {
    const { nodeId } = args;
    if (PROTECTED_IDS.includes(nodeId)) throw new Error(`Cannot delete structural node: ${nodeId}.`);
    const ctx = getContext();
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat[nodeId]) throw new Error(`Node "${nodeId}" not found.`);
    const parentId = flat[nodeId].parent;
    if (parentId && flat[parentId]) {
      flat[parentId].nodes = (flat[parentId].nodes || []).filter(id => id !== nodeId);
    }
    const deleteSubtree = (id) => {
      const node = flat[id];
      if (!node) return;
      for (const child of [...(node.nodes || [])]) deleteSubtree(child);
      delete flat[id];
    };
    deleteSubtree(nodeId);
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return { content: [{ type: 'text', text: `Node "${nodeId}" and descendants deleted.` }] };
    }
    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template'
      ? `Node "${nodeId}" and descendants deleted from template "${targetId}".`
      : `Node "${nodeId}" and descendants deleted.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },

  async insert_node(args) {
    const { nodeId, parentId, position, node } = args;
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (flat[nodeId]) throw new Error(`Node ID "${nodeId}" already exists. Use a unique ID.`);
    if (!flat[parentId]) throw new Error(`Parent node "${parentId}" not found.`);
    const nodeDef = parseMaybeJson(node) || node;
    nodeDef.parent = parentId;
    if (!nodeDef.linkedNodes) nodeDef.linkedNodes = {};
    if (!nodeDef.nodes) nodeDef.nodes = [];
    if (!nodeDef.hidden) nodeDef.hidden = false;
    if (!nodeDef.displayName && nodeDef.type?.resolvedName) nodeDef.displayName = nodeDef.type.resolvedName;
    const imgUrls = extractImageUrls(nodeDef.props, nodeDef.type?.resolvedName);
    if (imgUrls.length > 0) {
      const failures = await validateImageUrls(imgUrls);
      if (failures.length > 0) {
        const msg = failures.map(f => `  ${f.url} → ${f.status}`).join('\n');
        throw new Error(`Image validation failed — these URLs are broken:\n${msg}\n\nFix the URLs and try again.`);
      }
    }
    flat[nodeId] = nodeDef;
    const list = flat[parentId].nodes || (flat[parentId].nodes = []);
    const pos = position != null ? position : list.length;
    list.splice(pos, 0, nodeId);
    const result = await saveTarget(targetId, targetType, flat);
    const label = targetType === 'template'
      ? `Node "${nodeId}" inserted into "${parentId}" at position ${pos} in template "${targetId}".`
      : `Node "${nodeId}" inserted into "${parentId}" at position ${pos}.\nEditor: ${result.url}`;
    return { content: [{ type: 'text', text: label }] };
  },
};
