const { apiFetch } = require('../api-fetch');
const {
  parseMaybeJson, applyNodePatches,
  fetchSite, saveSite,
  extractImageUrls, validateImageUrls, collectAllImageUrls,
} = require('../helpers');

const PROTECTED_IDS = ['ROOT', 'page_home', 'hdr_root', 'hdr_section', 'hdr_inner', 'ftr_root', 'ftr_content', 'ftr_inner'];

module.exports = {
  async update_node(args) {
    const { nodeId, ...patches } = args;
    const { siteId, flat } = await fetchSite(args);
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
    const result = await saveSite(siteId, flat);
    return { content: [{ type: 'text', text: `Node ${nodeId} updated.\nEditor: ${result.url}` }] };
  },

  async delete_node(args) {
    const { nodeId } = args;
    if (PROTECTED_IDS.includes(nodeId)) throw new Error(`Cannot delete structural node: ${nodeId}`);
    const { siteId, flat } = await fetchSite(args);
    if (!flat[nodeId]) throw new Error(`Node ${nodeId} not found`);
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
    const result = await saveSite(siteId, flat);
    return { content: [{ type: 'text', text: `Node ${nodeId} (and descendants) deleted.\nEditor: ${result.url}` }] };
  },

  async insert_node(args) {
    const { nodeId, parentId, position, node } = args;
    const { siteId, flat } = await fetchSite(args);
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
    const result = await saveSite(siteId, flat);
    return { content: [{ type: 'text', text: `Node ${nodeId} inserted into ${parentId} at position ${pos}.\nEditor: ${result.url}` }] };
  },

  async set_integrations(args) {
    const { siteId, flat } = await fetchSite(args);
    if (!flat.ROOT?.props) throw new Error('Site has no ROOT node.');
    const integrations = {};
    if (args.googleAnalytics) integrations.googleAnalytics = { measurementId: args.googleAnalytics };
    if (args.googleTagManager) integrations.googleTagManager = { containerId: args.googleTagManager };
    if (args.googleSearchConsole) integrations.googleSearchConsole = { verificationCode: args.googleSearchConsole };
    if (args.metaPixel) integrations.metaPixel = { pixelId: args.metaPixel };
    flat.ROOT.props.integrations = { ...(flat.ROOT.props.integrations || {}), ...integrations };
    const result = await saveSite(siteId, flat);
    const providers = Object.keys(integrations).join(', ') || 'none';
    return { content: [{ type: 'text', text: `Integrations updated: ${providers}.\nEditor: ${result.url}` }] };
  },

  async set_redirects(args) {
    const { siteId, flat } = await fetchSite(args);
    if (!flat.ROOT?.props) throw new Error('Site has no ROOT node.');
    const redirects = (args.redirects || []).map(r => ({
      from: r.from,
      to: r.to,
      permanent: r.permanent !== false,
    }));
    flat.ROOT.props.redirects = redirects.length ? redirects : undefined;
    const result = await saveSite(siteId, flat);
    return { content: [{ type: 'text', text: `${redirects.length} redirect rule(s) saved.\nEditor: ${result.url}` }] };
  },
};
