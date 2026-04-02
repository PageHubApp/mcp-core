const { apiFetch, normalizeBaseUrl } = require('../api-fetch');
const { getContext } = require('../context');
const { parseMaybeJson, applyNodePatches, normalizeNodePatchArgs } = require('../helpers');

/** Collect a node and all its descendants from a flat map */
function collectSubtree(flat, nodeId) {
  const result = {};
  const walk = (id) => {
    if (!flat[id] || result[id]) return;
    result[id] = flat[id];
    for (const child of (flat[id].nodes || [])) walk(child);
  };
  walk(nodeId);
  return result;
}

/** Walk up to find the section root (type=section or child of page_home) */
function findSectionRoot(flat, nodeId) {
  let cur = nodeId;
  while (cur) {
    const n = flat[cur];
    if (!n) break;
    if (n.props?.type === 'section' || n.parent === 'page_home' || n.parent === 'ROOT') return cur;
    if (!n.parent) break;
    cur = n.parent;
  }
  return nodeId;
}

function getActiveSiteId(args) {
  const ctx = getContext();
  const id = args.id || ctx.activeSite?.id;
  if (!id) throw new Error('No site id provided and no active site set.');
  return id;
}

module.exports = {
  async list_templates() {
    const data = await apiFetch('/api/v1/templates');
    const lines = (data.templates || []).map(t =>
      `• ${t.slug} — ${t.title}${t.hidden ? ' (hidden)' : ''}`
    );
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'No templates found.' }] };
  },

  async pull_template(args) {
    const { slug } = args;
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const nodeCount = data.content ? Object.keys(data.content).length : 0;
    return {
      content: [{
        type: 'text',
        text: `Template "${slug}" fetched (${nodeCount} nodes).\n\n\`\`\`json\n${JSON.stringify(data.content, null, 2)}\n\`\`\``,
      }],
    };
  },

  async list_sites() {
    const data = await apiFetch('/api/v1/sites');
    const lines = (data.sites || []).map(s =>
      `• ${s._id} — ${s.name || '(unnamed)'}${s.domain ? ` [${s.domain}]` : ''} (updated ${s.updatedAt})`
    );
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'No sites found.' }] };
  },

  async select_site(args) {
    const { id } = args;
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(id)}`);
    const ctx = getContext();
    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };
    return { content: [{ type: 'text', text: `Active site set to ${data.id} (${data.name || 'unnamed'})` }] };
  },

  async pull_site(args) {
    const siteId = getActiveSiteId(args);
    const ctx = getContext();
    // Use pending draft if available (draftMode: unsaved changes from previous patches)
    const siteContent = ctx._pendingFlatMap || (await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`)).content;
    if (!siteContent) throw new Error('Site has no content.');
    const nodeCount = Object.keys(siteContent).length;
    return {
      content: [{
        type: 'text',
        text: `Site ${siteId} fetched (${nodeCount} nodes).\n\n\`\`\`json\n${JSON.stringify(siteContent, null, 2)}\n\`\`\``,
      }],
    };
  },

  async save_site(args) {
    const ctx = getContext();
    const content = parseMaybeJson(args.content) || ctx._pendingFlatMap;
    if (!content) {
      throw new Error('Provide content (inline JSON), or call patch_site_node/patch_site_bulk first.');
    }
    const targetId = args.createNew ? null : (args.id || ctx.activeSite?.id);

    // Dry run: return proposed content without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = content;
      // Diff: only return nodes that are new or changed vs the original site
      let changed = content;
      if (targetId) {
        try {
          const original = (await apiFetch(`/api/v1/sites/${encodeURIComponent(targetId)}`)).content;
          if (original) {
            const diff = {};
            for (const [id, node] of Object.entries(content)) {
              if (!original[id] || JSON.stringify(original[id]) !== JSON.stringify(node)) {
                diff[id] = node;
              }
            }
            // Include parent nodes so the section tree is complete
            for (const [id, node] of Object.entries(diff)) {
              const parentId = node?.parent;
              if (parentId && content[parentId] && !diff[parentId]) {
                diff[parentId] = content[parentId];
              }
            }
            if (Object.keys(diff).length > 0) changed = diff;
          }
        } catch {}
      }
      return {
        content: [{ type: 'text', text: `Site ${targetId || 'new'} saved successfully (${Object.keys(content).length} nodes).` }],
        pendingContent: content,
        changedNodes: changed,
      };
    }

    if (targetId) {
      const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        body: { content, name: args.name, title: args.title, description: args.description },
      });
      const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
      return {
        content: [{ type: 'text', text: `Site ${data.id} updated. View: ${base}/build/${data.id}` }],
      };
    }
    const data = await apiFetch('/api/v1/sites', {
      method: 'POST',
      body: { content, name: args.name, title: args.title, description: args.description },
    });
    ctx.activeSite = { id: data.id, name: data.name, draftId: data.draftId };
    return {
      content: [{ type: 'text', text: `New site created: ${data.id}\nEditor: ${data.url}\nPreview: ${data.staticUrl}` }],
    };
  },

  async delete_site(args) {
    const { id } = args;
    await apiFetch(`/api/v1/sites/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const ctx = getContext();
    if (ctx.activeSite?.id === id) ctx.activeSite = null;
    return { content: [{ type: 'text', text: `Site ${id} deleted.` }] };
  },

  async add_nodes(args) {
    const siteId = getActiveSiteId(args);
    const ctx = getContext();
    const sourceContent = ctx._pendingFlatMap || (await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`)).content;
    if (!sourceContent || typeof sourceContent !== 'object') {
      throw new Error('Site has no decoded content.');
    }
    const flat = JSON.parse(JSON.stringify(sourceContent));
    const nodes = parseMaybeJson(args.nodes);
    if (!nodes || typeof nodes !== 'object') throw new Error('nodes must be an object map of nodeId → node definition.');
    const parentId = args.parentId || 'page_home';
    if (!flat[parentId]) throw new Error(`Parent node "${parentId}" not found.`);

    // Merge new nodes into the flat map
    for (const [id, node] of Object.entries(nodes)) {
      if (flat[id]) throw new Error(`Node "${id}" already exists. Use patch_site_node to edit it.`);
      flat[id] = node;
    }

    // Add root-level new node to parent's children
    const rootNodeId = args.rootNodeId;
    if (rootNodeId) {
      const parentNodes = flat[parentId].nodes || [];
      const position = args.position != null ? args.position : parentNodes.length;
      parentNodes.splice(position, 0, rootNodeId);
      flat[parentId].nodes = parentNodes;
    }

    const changedNodes = {};
    for (const id of Object.keys(nodes)) {
      Object.assign(changedNodes, collectSubtree(flat, id));
    }

    // Dry run
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [{ type: 'text', text: `${Object.keys(nodes).length} nodes added to ${parentId} successfully.` }],
        pendingContent: flat,
        changedNodes,
      };
    }

    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, { method: 'PUT', body: { content: flat } });
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
    return {
      content: [{ type: 'text', text: `${Object.keys(nodes).length} nodes added. Editor: ${base}/build/${put.id}` }],
      changedNodes,
    };
  },

  async suggest_palettes(args) {
    // The model generates palette options as structured data in the args
    // We just pass them through for the frontend to render as clickable swatches
    const options = parseMaybeJson(args.options) || [];
    return {
      content: [{ type: 'text', text: `Generated ${options.length} palette options.` }],
      paletteOptions: options,
    };
  },

  async upload_image(args) {
    const siteId = getActiveSiteId(args);
    if (!args.imageUrl && !args.dataBase64) {
      throw new Error('Provide imageUrl or dataBase64.');
    }
    const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (args.mimeType && !ALLOWED_MIME.includes(args.mimeType)) {
      throw new Error(`Unsupported mimeType "${args.mimeType}". Allowed: ${ALLOWED_MIME.join(', ')}`);
    }
    const body = {
      ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
      ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
      ...(args.mimeType ? { mimeType: args.mimeType } : {}),
      ...(args.filename ? { filename: args.filename } : {}),
    };
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/media`, {
      method: 'POST',
      body,
    });
    return {
      content: [{
        type: 'text',
        text: `Uploaded.\n  mediaId: ${data.mediaId}\n  type: cdn\n  url: ${data.url}\n\nUse in nodes: { "type": "cdn", "content": "${data.mediaId}" }.`,
      }],
    };
  },

  async patch_site_node(args) {
    const siteId = getActiveSiteId(args);
    const { nodeId, name: siteName, title, description, nodesPatch, unsetProps, unsetMobile, unsetRoot } = args;
    const ctx = getContext();
    const sourceContent = ctx._pendingFlatMap || (await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`)).content;
    if (!sourceContent || typeof sourceContent !== 'object') {
      throw new Error('Site has no decoded content (empty or corrupt).');
    }
    const flat = JSON.parse(JSON.stringify(sourceContent));
    applyNodePatches(flat, nodeId, normalizeNodePatchArgs({ ...args, nodesPatch, unsetProps, unsetMobile, unsetRoot }));
    const changedNodes = collectSubtree(flat, findSectionRoot(flat, nodeId));

    // Dry run: return proposed changes without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [{ type: 'text', text: `Node ${nodeId} updated successfully.` }],
        pendingContent: flat,
        changedNodes,
      };
    }

    const putBody = { content: flat };
    if (siteName !== undefined) putBody.name = siteName;
    if (title !== undefined) putBody.title = title;
    if (description !== undefined) putBody.description = description;
    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
      method: 'PUT',
      body: putBody,
    });
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
    return {
      content: [{ type: 'text', text: `Site ${put.id} updated (node ${nodeId}).\nEditor: ${base}/build/${put.id}` }],
      changedNodes,
    };
  },

  async patch_site_bulk(args) {
    const siteId = getActiveSiteId(args);
    let list = args.patches;
    if (typeof list === 'string') list = parseMaybeJson(list);
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('patches must be a non-empty array of { nodeId, ...patch fields }.');
    }
    const ctx = getContext();
    const sourceContent = ctx._pendingFlatMap || (await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`)).content;
    if (!sourceContent || typeof sourceContent !== 'object') {
      throw new Error('Site has no decoded content (empty or corrupt).');
    }
    const flat = JSON.parse(JSON.stringify(sourceContent));
    const touched = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item.nodeId !== 'string') {
        throw new Error(`patches[${i}]: missing nodeId`);
      }
      const { nodeId: nid, name: _name, title: _title, description: _desc, id: _id, patches: _patches, ...rest } = item;
      applyNodePatches(flat, nid, normalizeNodePatchArgs(rest));
      touched.push(nid);
    }
    const changedNodes = Object.assign({}, ...touched.map(id => collectSubtree(flat, findSectionRoot(flat, id))));

    // Dry run: return proposed changes without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [{ type: 'text', text: `${touched.length} nodes updated successfully: ${touched.join(', ')}.` }],
        pendingContent: flat,
        changedNodes,
      };
    }

    const { name: siteName, title, description } = args;
    const putBody = { content: flat };
    if (siteName !== undefined) putBody.name = siteName;
    if (title !== undefined) putBody.title = title;
    if (description !== undefined) putBody.description = description;
    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
      method: 'PUT',
      body: putBody,
    });
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
    return {
      content: [{ type: 'text', text: `Site ${put.id} updated (${touched.length} nodes: ${touched.join(', ')}).\nEditor: ${base}/build/${put.id}` }],
      changedNodes,
    };
  },
};
