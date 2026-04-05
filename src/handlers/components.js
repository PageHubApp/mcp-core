const { apiFetch } = require('../api-fetch');
const {
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
} = require('../helpers');
const {
  hierarchicalLibraryToFlat,
  flatLibraryToHierarchical,
  formatBlockNodeManifest,
} = require('../structure-ingest');

module.exports = {
  async search_blocks(args) {
    const params = new URLSearchParams();
    if (args.q) params.set('q', args.q);
    if (args.category) params.set('category', args.category);
    if (args.subcategory) params.set('subcategory', args.subcategory);
    if (args.tag) params.set('tag', args.tag);
    if (args.preset) params.set('preset', args.preset);
    if (args.source) params.set('source', args.source);
    if (args.group) params.set('group', args.group);
    if (args.featured) params.set('featured', 'true');
    if (args.sort) params.set('sort', args.sort);
    if (args.page) params.set('page', String(args.page));
    if (args.limit) params.set('limit', String(args.limit));

    const qs = params.toString();
    let data = await apiFetch(`/api/v1/components${qs ? `?${qs}` : ''}`);
    let { components, total, page, pages } = data;
    let broadened = false;

    if (!components.length && args.q) {
      const wide = new URLSearchParams();
      if (args.category) wide.set('category', args.category);
      if (args.subcategory) wide.set('subcategory', args.subcategory);
      if (args.tag) wide.set('tag', args.tag);
      if (args.preset) wide.set('preset', args.preset);
      if (args.source) wide.set('source', args.source);
      if (args.group) wide.set('group', args.group);
      if (args.featured) wide.set('featured', 'true');
      if (args.sort) wide.set('sort', args.sort);
      if (args.page) wide.set('page', String(args.page));
      if (args.limit) wide.set('limit', String(args.limit));
      const qs2 = wide.toString();
      const data2 = await apiFetch(`/api/v1/components${qs2 ? `?${qs2}` : ''}`);
      if (data2.components?.length) {
        data = data2;
        components = data2.components;
        total = data2.total;
        page = data2.page;
        pages = data2.pages;
        broadened = true;
      }
    }

    if (!components.length) {
      return { content: [{ type: 'text', text: 'No blocks found matching your query.' }] };
    }

    const lines = components.map(c => {
      const catLabel = c.subcategory ? `${c.category}/${c.subcategory}` : c.category;
      let line = `• **${c.name}** (\`${c.slug}\`) — ${catLabel} · ${c.uses} uses · ${c.likes} likes`;
      const presetLabel = c.preset || c.source;
      if (presetLabel || c.group) line += `\n  Preset: ${presetLabel || '—'} · Group: ${c.group || '—'}`;
      line += `\n  ${c.description || c.visual || ''}\n  Tags: ${(c.tags || []).join(', ')}`;
      return line;
    });

    const pageCount = pages != null ? pages : 1;
    const pageNum = page != null ? page : 1;
    const totalCount = total != null ? total : components.length;
    const paginationNote =
      pageCount > 1
        ? `**More exist:** ${totalCount} total — this is **page ${pageNum} of ${pageCount}**. Call \`search_blocks\` again with the same filters and \`page: ${pageNum + 1}\` (etc.) to see more. For a full category slug list in one shot, use \`list_blocks({ category: "…" })\` (planner only).\n\n`
        : totalCount > components.length
          ? `**Note:** ${totalCount} total matches; this response lists ${components.length}. If you need more breadth, raise \`limit\` (max 100) or use \`list_blocks\`.\n\n`
          : '';

    const head = broadened
      ? `# Blocks (${totalCount} total, page ${pageNum}/${pageCount})\n\n*(Search widened: dropped text query \`q\` because it returned no hits — prefer category/tag alone next time.)*\n\n${paginationNote}`
      : `# Blocks (${totalCount} total, page ${pageNum}/${pageCount})\n\n${paginationNote}`;
    return {
      content: [{
        type: 'text',
        text: `${head}${lines.join('\n\n')}\n\n**Selection:** Read name, description, and tags; shortlist 2–4 finalists that match the user request, then pick one slug **exactly** as shown in backticks. If the header is **page 1 of 1** and the number of bullets matches total N, this response is the **full** result set for that query. If **Y > 1**, more pages exist — call \`search_blocks\` with \`page: 2\` (etc.) before claiming you listed every block.\n\nUse \`get_block(slug)\` for full structure (heavy); prefer comparing metadata above first.`,
      }],
    };
  },

  async get_block(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
    const c = data.component;

    return {
      content: [{
        type: 'text',
        text: `# ${c.name} (\`${c.slug}\`)\n\n**Category:** ${c.category}${c.preset || c.source ? `\n**Preset:** ${c.preset || c.source}${c.source && !c.preset ? ' (from legacy source field)' : ''}` : ''}${c.group ? `\n**Group:** ${c.group}` : ''}\n**Description:** ${c.description || ''}\n**Visual:** ${c.visual || ''}\n**Tags:** ${(c.tags || []).join(', ')}\n**Uses:** ${c.uses} · **Likes:** ${c.likes}\n\n**Patching:** Call \`list_block_nodes({ slug: "${c.slug}" })\` for deterministic \`lib_*\` node ids, then \`patch_block\` / \`patch_block_bulk\` (same patch fields as \`patch_site_node\`).\n\n## Structure\n\n\`\`\`json\n${JSON.stringify(c.structure, null, 2)}\n\`\`\``,
      }],
    };
  },

  /**
   * Deterministic lib_* node id manifest for a library block (for patch_block / patch_block_bulk).
   */
  async list_block_nodes(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
    const c = data.component;
    if (!c?.structure || typeof c.structure !== 'object') {
      throw new Error('Component has no structure to flatten.');
    }

    const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
    const manifest = formatBlockNodeManifest(nodes, rootId, slug);

    return {
      content: [{
        type: 'text',
        text: `# ${c.name} (\`${c.slug}\`)\n\n${manifest}\n\nPatch with the same \`slug\` you passed here (\`${slug}\`) so ids stay aligned.`,
      }],
    };
  },

  async save_block(args) {
    const { name, slug, description, visual, category, subcategory, tags, preset, source, group, structure, isPublic, isCategoryPreview } = args;
    if (!name || !slug || !category || !structure) {
      throw new Error('name, slug, category, and structure are required');
    }

    const data = await apiFetch('/api/v1/components', {
      method: 'POST',
      body: { name, slug, description, visual, category, subcategory, tags, preset, source, group, structure, isPublic, isCategoryPreview },
    });

    return {
      content: [{
        type: 'text',
        text: `Block saved: **${data.component.name}** (\`${data.component.slug}\`)\nPublic: ${data.component.isPublic}\nCategory: ${data.component.category}`,
      }],
    };
  },

  async update_block(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');

    const body = {};
    const fields = ['name', 'description', 'visual', 'category', 'subcategory', 'tags', 'preset', 'source', 'group', 'structure', 'isPublic', 'isFeatured', 'isCategoryPreview', 'newSlug'];
    for (const f of fields) {
      if (args[f] !== undefined) {
        body[f === 'newSlug' ? 'slug' : f] = args[f];
      }
    }

    if (Object.keys(body).length === 0) {
      throw new Error('Nothing to update. Provide at least one field to change.');
    }

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body,
    });

    const c = data.component;
    return {
      content: [{
        type: 'text',
        text: `Block updated: **${c.name}** (\`${c.slug}\`)\nCategory: ${c.category}\nPublic: ${c.isPublic}`,
      }],
    };
  },

  async patch_block(args) {
    const { slug, nodeId } = args;
    if (!slug) throw new Error('slug is required');
    if (!nodeId) throw new Error('nodeId is required');
    assertPatchBlockNodeArgs(args);

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
    const c = data.component;
    if (!c?.structure || typeof c.structure !== 'object') {
      throw new Error('Component has no structure to patch.');
    }

    const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
    const flat = JSON.parse(JSON.stringify(nodes));
    const {
      nodesPatch,
      unsetProps,
      unsetClasses,
    } = args;
    applyNodePatches(
      flat,
      nodeId,
      normalizeNodePatchArgs({ ...args, nodesPatch, unsetProps, unsetClasses })
    );
    const newStructure = flatLibraryToHierarchical(flat, rootId);

    await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body: { structure: newStructure },
    });

    return {
      content: [{
        type: 'text',
        text: `Block \`${slug}\` patched (node \`${nodeId}\`). Structure saved. Re-run list_block_nodes if you renamed the slug.`,
      }],
    };
  },

  async patch_block_bulk(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');

    const list = normalizeBulkPatchesFromArgs(args);
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(
        'patches must be a non-empty array of { nodeId, classNamePatch?, propsPatch?, ... } (same shape as patch_site_bulk).'
      );
    }

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
    const c = data.component;
    if (!c?.structure || typeof c.structure !== 'object') {
      throw new Error('Component has no structure to patch.');
    }

    const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
    const flat = JSON.parse(JSON.stringify(nodes));
    const touched = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item.nodeId !== 'string') {
        throw new Error(`patches[${i}]: missing nodeId`);
      }
      assertPatchBlockBulkItem(item, i);
      const { nodeId: nid, patches: _patches, ...rest } = item;
      applyNodePatches(flat, nid, normalizeNodePatchArgs(rest));
      touched.push(nid);
    }

    const newStructure = flatLibraryToHierarchical(flat, rootId);

    await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
      method: 'PUT',
      body: { structure: newStructure },
    });

    return {
      content: [{
        type: 'text',
        text: `Block \`${slug}\` patched (${touched.length} nodes): ${touched.join(', ')}. Structure saved.`,
      }],
    };
  },

  async delete_block(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');
    await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: `Block "${slug}" deleted.` }] };
  },
};
