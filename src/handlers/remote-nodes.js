const { apiFetch } = require('../api-fetch');
const { getContext } = require('../context');
const {
  parseMaybeJson,
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  getActiveTarget,
  fetchTarget,
  saveTarget,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
  guardRootCompanyPropsPatch,
} = require('../helpers');
const { collectSubtree, sanitizeNodes, findSectionRoot } = require('../node-utils');
const { resultMsg } = require('./remote-shared');

module.exports = {
  async add_nodes(args) {
    const target = getActiveTarget(args);
    const ctx = getContext();
    if (ctx.fillMode && ctx._fillStructureLocked) {
      throw new Error(
        'This fill already created structure (kit or prior add_nodes). Use patch_site_node / patch_site_bulk only — do not call add_nodes again.'
      );
    }
    const { flat } = await fetchTarget(args);

    let parentId = args.parentId != null && args.parentId !== '' ? String(args.parentId) : 'page_home';
    if (ctx.fillMode && ctx.sectionNodeId) {
      const sec = String(ctx.sectionNodeId);
      if (args.parentId == null || args.parentId === '') {
        parentId = sec;
      } else if (parentId !== sec) {
        throw new Error(
          `Parallel fill: add_nodes parentId must be your section "${sec}". Omit parentId to default there — never use page_home or another section.`
        );
      }
    }

    const rawNodes = parseMaybeJson(args.nodes);
    if (!rawNodes || typeof rawNodes !== 'object') throw new Error('nodes must be an object map of nodeId → node definition.');
    if (!flat[parentId]) throw new Error(`Parent node "${parentId}" not found.`);

    // Sanitize: parse strings, validate types, rebuild parent↔children, reparent orphans
    const { nodes: cleanNodes, roots } = sanitizeNodes(rawNodes, flat, parentId);
    if (Object.keys(cleanNodes).length === 0) {
      return { content: [{ type: 'text', text: 'No valid nodes to add.' }], changedNodes: {} };
    }

    // Merge sanitized nodes into the flat map
    for (const [id, node] of Object.entries(cleanNodes)) {
      flat[id] = node;
    }

    // Register root nodes as children of the parent container
    const parentNodes = flat[parentId].nodes || [];
    const position = args.position != null ? args.position : parentNodes.length;
    for (let i = 0; i < roots.length; i++) {
      parentNodes.splice(position + i, 0, roots[i]);
    }
    flat[parentId].nodes = parentNodes;

    const changedNodes = {};
    for (const id of Object.keys(cleanNodes)) {
      Object.assign(changedNodes, collectSubtree(flat, id));
    }

    // Dry run
    if (ctx.draftMode) {
      if (ctx.fillMode) {
        // Build a minimal patch: only new nodes + the updated section container
        const patch = { ...cleanNodes };
        patch[parentId] = flat[parentId];
        if (!ctx._fillPatch) ctx._fillPatch = {};
        Object.assign(ctx._fillPatch, patch);
        ctx._pendingFlatMap = flat;
      } else {
        ctx._pendingFlatMap = flat;
      }
      return {
        content: [{ type: 'text', text: `${Object.keys(cleanNodes).length} nodes added to ${parentId} successfully.` }],
        pendingContent: ctx.fillMode ? ctx._pendingFlatMap : flat,
        changedNodes,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    return {
      content: [{ type: 'text', text: resultMsg(target.id, target.type, `${Object.keys(cleanNodes).length} nodes added.`) }],
      changedNodes,
    };
  },

  async patch_site_node(args) {
    const target = getActiveTarget(args);
    assertPatchSiteNodeArgs(args);
    const {
      nodeId,
      name: siteName,
      title,
      description,
      nodesPatch,
      unsetProps,
      unsetClasses,
    } = args;
    const ctx = getContext();
    const { flat } = await fetchTarget(args);
    assertFillModePatchAllowed(flat, nodeId, ctx);
    let patchArgs = normalizeNodePatchArgs({ ...args, nodesPatch, unsetProps, unsetClasses });
    if (String(nodeId) === 'ROOT' && patchArgs.propsPatch) {
      patchArgs = { ...patchArgs, propsPatch: guardRootCompanyPropsPatch(flat, patchArgs.propsPatch, ctx) };
    }
    applyNodePatches(flat, nodeId, patchArgs);
    const changedNodes = collectSubtree(flat, findSectionRoot(flat, nodeId));

    // Dry run: return proposed changes without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      if (ctx.fillMode && changedNodes) {
        if (!ctx._fillPatch) ctx._fillPatch = {};
        Object.assign(ctx._fillPatch, changedNodes);
      }
      return {
        content: [{ type: 'text', text: `Node ${nodeId} updated successfully.` }],
        pendingContent: flat,
        changedNodes,
      };
    }

    const extra = {};
    if (siteName !== undefined) extra.name = siteName;
    if (title !== undefined) extra.title = title;
    if (description !== undefined) extra.description = description;
    const result = await saveTarget(target.id, target.type, flat, extra);
    return {
      content: [{ type: 'text', text: resultMsg(result.id, target.type, `Updated (node ${nodeId}).`) }],
      changedNodes,
    };
  },

  async patch_site_bulk(args) {
    const target = getActiveTarget(args);
    const list = normalizeBulkPatchesFromArgs(args);
    if (!Array.isArray(list) || list.length === 0) {
      const p = args.patches !== undefined ? args.patches : args.patch;
      let received = 'missing patches';
      if (p !== undefined) {
        if (p === null) received = 'null';
        else if (typeof p === 'string') received = `string (length ${p.length})`;
        else if (Array.isArray(p)) received = `array length ${p.length}`;
        else if (typeof p === 'object') received = `object keys: ${Object.keys(p).slice(0, 12).join(', ')}`;
        else received = typeof p;
      }
      let jsonHint = '';
      if (typeof p === 'string' && p.length > 0) {
        jsonHint =
          ' Prefer patches as a native JSON array (not a string). If string: valid JSON only — escape quotes in text or use patch_site_node.';
      }
      throw new Error(
        `patches must be a non-empty array of { nodeId, classNamePatch?, propsPatch?, ... }. ` +
          `Always use an array even for one node, e.g. [{ "nodeId": "kit_text_1", "propsPatch": { ... } }]. (${received})${jsonHint}`
      );
    }
    const ctx = getContext();
    const { flat } = await fetchTarget(args);
    assertFillModeBulkPatchesAllowed(flat, list, ctx);
    const touched = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item.nodeId !== 'string') {
        throw new Error(`patches[${i}]: missing nodeId`);
      }
      assertPatchBulkItem(item, i);
      const { nodeId: nid, name: _name, title: _title, description: _desc, id: _id, patches: _patches, ...rest } = item;
      assertFillModePatchAllowed(flat, nid, ctx);
      let bulkPatch = normalizeNodePatchArgs(rest);
      if (String(nid) === 'ROOT' && bulkPatch.propsPatch) {
        bulkPatch = { ...bulkPatch, propsPatch: guardRootCompanyPropsPatch(flat, bulkPatch.propsPatch, ctx) };
      }
      applyNodePatches(flat, nid, bulkPatch);
      touched.push(nid);
    }
    const changedNodes = Object.assign({}, ...touched.map(id => collectSubtree(flat, findSectionRoot(flat, id))));

    // Dry run: return proposed changes without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      if (ctx.fillMode && changedNodes) {
        if (!ctx._fillPatch) ctx._fillPatch = {};
        Object.assign(ctx._fillPatch, changedNodes);
      }
      return {
        content: [{ type: 'text', text: `${touched.length} nodes updated successfully: ${touched.join(', ')}.` }],
        pendingContent: flat,
        changedNodes,
      };
    }

    const { name: siteName, title, description } = args;
    const extra = {};
    if (siteName !== undefined) extra.name = siteName;
    if (title !== undefined) extra.title = title;
    if (description !== undefined) extra.description = description;
    const result = await saveTarget(target.id, target.type, flat, extra);
    return {
      content: [{ type: 'text', text: resultMsg(result.id, target.type, `Updated (${touched.length} nodes: ${touched.join(', ')}).`) }],
      changedNodes,
    };
  },
};
