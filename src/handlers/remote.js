const { apiFetch, normalizeBaseUrl } = require('../api-fetch');
const { getContext } = require('../context');
const { parseMaybeJson, applyNodePatches, normalizeNodePatchArgs, getActiveTarget, fetchTarget, saveTarget } = require('../helpers');

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

const VALID_COMPONENTS = new Set([
  'Audio', 'Background', 'Button', 'ButtonList', 'Container', 'ContainerGroup',
  'Divider', 'Embed', 'Footer', 'Form', 'FormElement', 'Header', 'Image',
  'ImageList', 'Map', 'MapPoint', 'Modal', 'Nav', 'Spacer', 'Text', 'Video',
]);

const CANVAS_COMPONENTS = new Set([
  'Container', 'ContainerGroup', 'Footer', 'Header', 'Nav', 'Form', 'Background', 'Modal',
]);

/**
 * Sanitize AI-generated nodes into a valid CraftJS subtree.
 * - Parses string values
 * - Strips nodes with invalid/missing type.resolvedName
 * - Strips nodes that duplicate existing IDs in the flat map
 * - Rebuilds parent ↔ children relationships from the children (nodes) arrays
 * - Removes references to non-existent children
 * - Reparents orphans to the section container
 * - Ensures isCanvas, nodes[], linkedNodes{} on every node
 * Returns a clean map of only the new nodes (no existing/skeleton nodes).
 */
function sanitizeNodes(rawNodes, existingFlat, sectionContainerId) {
  const clean = {};

  // Step 1: Parse and validate — only keep nodes with valid component types
  for (const [id, rawNode] of Object.entries(rawNodes)) {
    if (id === sectionContainerId) continue; // never overwrite the container
    const node = typeof rawNode === 'string' ? parseMaybeJson(rawNode) : rawNode;
    if (!node || typeof node !== 'object') continue;
    if (!node.type?.resolvedName || !VALID_COMPONENTS.has(node.type.resolvedName)) continue;
    if (existingFlat[id]) continue; // don't overwrite existing nodes
    clean[id] = node;
  }

  if (Object.keys(clean).length === 0) return clean;

  // Step 2: Ensure required fields on every node
  for (const [id, node] of Object.entries(clean)) {
    const isCanvas = CANVAS_COMPONENTS.has(node.type.resolvedName);
    node.isCanvas = isCanvas;
    if (!Array.isArray(node.nodes)) node.nodes = [];
    if (!node.linkedNodes || typeof node.linkedNodes !== 'object') node.linkedNodes = {};
    if (node.hidden == null) node.hidden = false;
    if (!node.displayName) node.displayName = node.type.resolvedName;
    if (!node.custom) node.custom = {};
    if (!node.props) node.props = {};
    if (!node.props.root) node.props.root = {};
    if (!node.props.mobile) node.props.mobile = {};
    if (!node.props.desktop) node.props.desktop = {};

    // Strip class/className/style attributes from Text content — AI keeps adding them
    if (node.type.resolvedName === 'Text' && node.props.root?.text) {
      node.props.root.text = node.props.root.text
        .replace(/\s*(class|className|style)="[^"]*"/gi, '')
        .replace(/<(p|div|h[1-6]|span)[^>]*>/gi, (match, tag) => `<${tag}>`)
        .trim();
    }
  }

  // Step 3: Remove children references that don't exist in clean or existingFlat
  const allIds = new Set([...Object.keys(clean), ...Object.keys(existingFlat)]);
  for (const node of Object.values(clean)) {
    node.nodes = node.nodes.filter(childId => allIds.has(childId));
  }

  // Step 4: Rebuild parent↔children from the DEEPEST claim
  // If multiple nodes claim the same child, the deepest (most nested) parent wins.
  // First pass: find all claims, last writer wins for parent assignment.
  const parentOf = {}; // childId → parentId
  for (const [id, node] of Object.entries(clean)) {
    for (const childId of node.nodes) {
      if (clean[childId]) {
        parentOf[childId] = id;
      }
    }
  }

  // Set parent refs
  for (const [childId, pid] of Object.entries(parentOf)) {
    clean[childId].parent = pid;
  }

  // Rebuild children arrays from parent refs (single source of truth)
  for (const node of Object.values(clean)) {
    node.nodes = [];
  }
  for (const [id, node] of Object.entries(clean)) {
    const pid = node.parent;
    if (pid && clean[pid]) {
      clean[pid].nodes.push(id);
    }
  }

  // Step 5: Reparent orphans (no parent in clean) to the section container
  const roots = [];
  for (const [id, node] of Object.entries(clean)) {
    if (!node.parent || !clean[node.parent]) {
      node.parent = sectionContainerId;
      roots.push(id);
    }
  }
  // Log sanitizer results for debugging
  const inputCount = Object.keys(rawNodes).length;
  const outputCount = Object.keys(clean).length;
  const stripped = inputCount - outputCount;
  if (stripped > 0 || roots.length === 0) {
    console.log(`[sanitize] ${sectionContainerId}: ${inputCount} in → ${outputCount} kept, ${stripped} stripped, ${roots.length} roots`);
    // Log what was stripped
    for (const id of Object.keys(rawNodes)) {
      if (!clean[id] && id !== sectionContainerId) {
        const raw = typeof rawNodes[id] === 'string' ? rawNodes[id].slice(0, 80) : JSON.stringify(rawNodes[id])?.slice(0, 80);
        console.log(`  stripped: ${id} → ${raw}`);
      }
    }
  }

  return { nodes: clean, roots };
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
  return getActiveTarget(args).id;
}

/** Format result message with editor URL (sites) or slug (templates). */
function resultMsg(targetId, targetType, msg) {
  if (targetType === 'template') return `Template "${targetId}": ${msg}`;
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
  return `${msg}\nEditor: ${base}/build/${targetId}`;
}

module.exports = {
  async select_template(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required.');
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    const ctx = getContext();
    ctx.activeTemplate = { slug: data.slug, title: data.title };
    // Clear activeSite so template takes priority
    ctx.activeSite = null;
    return { content: [{ type: 'text', text: `Active template set to "${data.slug}" (${data.title || 'untitled'})` }] };
  },

  async list_templates(args = {}) {
    const params = new URLSearchParams();
    if (args.category) params.set('category', args.category);
    if (args.tag) params.set('tag', args.tag);
    if (args.q) params.set('q', args.q);
    const qs = params.toString();
    const data = await apiFetch(`/api/v1/templates${qs ? `?${qs}` : ''}`);
    const lines = (data.templates || []).map(t => {
      let line = `• ${t.slug} — ${t.title}`;
      if (t.category) line += ` [${t.category}]`;
      if (t.tags?.length) line += ` (${t.tags.join(', ')})`;
      if (t.hidden) line += ' (hidden)';
      return line;
    });
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

  async save_template(args) {
    const { slug, title, description, image, category, tags, content, hidden, isPublic } = args;
    if (!slug || !title || !content) {
      throw new Error('slug, title, and content are required');
    }
    const data = await apiFetch('/api/v1/templates', {
      method: 'POST',
      body: { slug, title, description, image, category, tags, content, hidden, isPublic },
    });
    return {
      content: [{
        type: 'text',
        text: `Template saved: **${data.title}** (\`${data.slug}\`)`,
      }],
    };
  },

  async publish_site_as_template(args) {
    const { slug, title, description, image, category, tags, hidden, isPublic } = args;
    const target = getActiveTarget(args);
    if (target.type !== 'site') throw new Error('Active target must be a site. Use select_site first.');
    const siteData = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`);
    if (!siteData.content) throw new Error('Site has no content.');
    const finalSlug = slug || siteData.slug || target.id;
    const finalTitle = title || siteData.name || siteData.title || finalSlug;
    const body = {
      slug: finalSlug, title: finalTitle, content: siteData.content,
      ...(description && { description }),
      ...(image && { image }),
      ...(category && { category }),
      ...(tags && { tags }),
      ...(hidden !== undefined && { hidden }),
      ...(isPublic !== undefined && { isPublic }),
    };
    const data = await apiFetch('/api/v1/templates', { method: 'POST', body });
    return {
      content: [{ type: 'text', text: `Site published as template: **${data.title}** (\`${data.slug}\`)\nPreview: ${data.image || 'no image set'}` }],
    };
  },

  async update_template(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');
    const body = {};
    for (const f of ['title', 'description', 'image', 'category', 'tags', 'content', 'hidden']) {
      if (args[f] !== undefined) body[f] = args[f];
    }
    if (Object.keys(body).length === 0) {
      throw new Error('Nothing to update. Provide at least one field.');
    }
    const data = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body,
    });
    return {
      content: [{
        type: 'text',
        text: `Template updated: **${data.title}** (\`${data.slug}\`)`,
      }],
    };
  },

  async delete_template(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');
    await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: `Template "${slug}" deleted.` }] };
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
    // Clear activeTemplate so site takes priority
    ctx.activeTemplate = null;
    return { content: [{ type: 'text', text: `Active site set to ${data.id} (${data.name || 'unnamed'})` }] };
  },

  async pull_site(args) {
    const target = getActiveTarget(args);
    const ctx = getContext();
    let content;
    if (ctx._pendingFlatMap) {
      content = ctx._pendingFlatMap;
    } else if (target.type === 'template') {
      content = (await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`)).content;
    } else {
      content = (await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`)).content;
    }
    if (!content) throw new Error(`${target.type === 'template' ? 'Template' : 'Site'} has no content.`);
    const nodeCount = Object.keys(content).length;
    const label = target.type === 'template' ? `Template "${target.id}"` : `Site ${target.id}`;
    return {
      content: [{
        type: 'text',
        text: `${label} fetched (${nodeCount} nodes).\n\n\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``,
      }],
    };
  },

  async save_site(args) {
    const ctx = getContext();
    const content = parseMaybeJson(args.content) || ctx._pendingFlatMap;
    if (!content) {
      throw new Error('Provide content (inline JSON), or call patch_site_node/patch_site_bulk first.');
    }

    const target = (() => {
      try { return getActiveTarget(args); } catch { return null; }
    })();
    const targetId = args.createNew ? null : target?.id;
    const targetType = target?.type || 'site';

    // Dry run: return proposed content without saving
    if (ctx.draftMode) {
      ctx._pendingFlatMap = content;
      let changed = content;
      if (targetId) {
        try {
          const fetchUrl = targetType === 'template'
            ? `/api/v1/templates/${encodeURIComponent(targetId)}`
            : `/api/v1/sites/${encodeURIComponent(targetId)}`;
          const original = (await apiFetch(fetchUrl)).content;
          if (original) {
            const diff = {};
            for (const [id, node] of Object.entries(content)) {
              if (!original[id] || JSON.stringify(original[id]) !== JSON.stringify(node)) {
                diff[id] = node;
              }
            }
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
      const label = targetType === 'template' ? `Template "${targetId || 'new'}"` : `Site ${targetId || 'new'}`;
      return {
        content: [{ type: 'text', text: `${label} saved successfully (${Object.keys(content).length} nodes).` }],
        pendingContent: content,
        changedNodes: changed,
      };
    }

    if (targetId) {
      const result = await saveTarget(targetId, targetType, content, {
        name: args.name, title: args.title, description: args.description,
      });
      if (targetType === 'template') {
        return { content: [{ type: 'text', text: `Template "${result.id}" updated.` }] };
      }
      const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
      return {
        content: [{ type: 'text', text: `Site ${result.id} updated. View: ${base}/build/${result.id}` }],
      };
    }
    // Create new — sites only (templates use save_template for creation)
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
    const target = getActiveTarget(args);
    const ctx = getContext();
    let sourceContent;
    if (ctx._pendingFlatMap) {
      sourceContent = ctx._pendingFlatMap;
    } else if (target.type === 'template') {
      sourceContent = (await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`)).content;
    } else {
      sourceContent = (await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`)).content;
    }
    if (!sourceContent || typeof sourceContent !== 'object') {
      throw new Error(`${target.type === 'template' ? 'Template' : 'Site'} has no decoded content.`);
    }
    const flat = JSON.parse(JSON.stringify(sourceContent));
    const rawNodes = parseMaybeJson(args.nodes);
    if (!rawNodes || typeof rawNodes !== 'object') throw new Error('nodes must be an object map of nodeId → node definition.');
    const parentId = args.parentId || 'page_home';
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
    const target = getActiveTarget(args);
    if (target.type === 'template') {
      throw new Error('upload_image is not supported for templates. Use hardcoded image URLs (type: "url") instead.');
    }
    const siteId = target.id;
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
    const target = getActiveTarget(args);
    const { nodeId, name: siteName, title, description, nodesPatch, unsetProps, unsetMobile, unsetRoot } = args;
    const ctx = getContext();
    let sourceContent;
    if (ctx._pendingFlatMap) {
      sourceContent = ctx._pendingFlatMap;
    } else if (target.type === 'template') {
      sourceContent = (await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`)).content;
    } else {
      sourceContent = (await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`)).content;
    }
    if (!sourceContent || typeof sourceContent !== 'object') {
      throw new Error(`${target.type === 'template' ? 'Template' : 'Site'} has no decoded content (empty or corrupt).`);
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
    let list = args.patches;
    if (typeof list === 'string') list = parseMaybeJson(list);
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error('patches must be a non-empty array of { nodeId, ...patch fields }.');
    }
    const ctx = getContext();
    let sourceContent;
    if (ctx._pendingFlatMap) {
      sourceContent = ctx._pendingFlatMap;
    } else if (target.type === 'template') {
      sourceContent = (await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`)).content;
    } else {
      sourceContent = (await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`)).content;
    }
    if (!sourceContent || typeof sourceContent !== 'object') {
      throw new Error(`${target.type === 'template' ? 'Template' : 'Site'} has no decoded content (empty or corrupt).`);
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

  async set_theme(args) {
    const { preset, palette, styleGuide, fonts, jsonLd } = args;
    const target = getActiveTarget(args);
    const ctx = getContext();

    // Load current content
    let sourceContent;
    if (ctx._pendingFlatMap) {
      sourceContent = ctx._pendingFlatMap;
    } else if (target.type === 'template') {
      sourceContent = (await apiFetch(`/api/v1/templates/${encodeURIComponent(target.id)}`)).content;
    } else {
      sourceContent = (await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`)).content;
    }
    if (!sourceContent?.ROOT) throw new Error('Site/template has no ROOT node.');

    const flat = JSON.parse(JSON.stringify(sourceContent));
    const rootProps = flat.ROOT.props;

    // Resolve preset values (explicit args override preset)
    let resolvedPalette = parseMaybeJson(palette);
    let resolvedStyleGuide = parseMaybeJson(styleGuide);
    let resolvedFonts = parseMaybeJson(fonts);
    if (preset) {
      const presetData = await apiFetch(`/api/v1/presets/${encodeURIComponent(preset)}`);
      const found = presetData.preset;
      if (!found) throw new Error(`Preset "${preset}" not found. Use list_presets to see available presets.`);
      if (!resolvedPalette) resolvedPalette = found.palette;
      if (!resolvedStyleGuide) resolvedStyleGuide = found.styleGuide;
      if (!resolvedFonts) resolvedFonts = found.fonts;
    }

    // Apply palette → ROOT.props.pallet (note: legacy misspelling)
    if (resolvedPalette) rootProps.pallet = resolvedPalette;

    // Merge styleGuide
    if (resolvedStyleGuide) {
      rootProps.styleGuide = { ...(rootProps.styleGuide || {}), ...resolvedStyleGuide };
    }

    // Build header with Google Fonts + JSON-LD
    const pre =
      '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
    let fontBlock = '';
    if (resolvedFonts?.url) {
      fontBlock = `<link href="${resolvedFonts.url}" rel="stylesheet">`;
    } else if (resolvedFonts?.families?.length) {
      const q = resolvedFonts.families.map(f => `family=${f.replace(/ /g, '+')}`).join('&');
      fontBlock = `<link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`;
    }
    let ld = '';
    const resolvedJsonLd = parseMaybeJson(jsonLd);
    if (resolvedJsonLd) {
      ld = `<script type="application/ld+json">${JSON.stringify(resolvedJsonLd)}</script>`;
    }
    if (fontBlock || ld) {
      rootProps.header = pre + fontBlock + ld;
    }

    const changedNodes = { ROOT: flat.ROOT };
    const presetMsg = preset ? ` (preset: ${preset})` : '';

    // Draft mode: store in pending flat map for aiDraft save
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [{ type: 'text', text: `Theme updated${presetMsg}.` }],
        pendingContent: flat,
        changedNodes,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    return {
      content: [{ type: 'text', text: resultMsg(result.id, target.type, `Theme updated${presetMsg}.`) }],
      changedNodes,
    };
  },
};
