const { apiFetch } = require('../api-fetch');

module.exports = {
  async list_components(args) {
    const params = new URLSearchParams();
    if (args.q) params.set('q', args.q);
    if (args.category) params.set('category', args.category);
    if (args.subcategory) params.set('subcategory', args.subcategory);
    if (args.tag) params.set('tag', args.tag);
    if (args.source) params.set('source', args.source);
    if (args.group) params.set('group', args.group);
    if (args.featured) params.set('featured', 'true');
    if (args.sort) params.set('sort', args.sort);
    if (args.page) params.set('page', String(args.page));
    if (args.limit) params.set('limit', String(args.limit));

    const qs = params.toString();
    const data = await apiFetch(`/api/v1/components${qs ? `?${qs}` : ''}`);
    const { components, total, page, pages } = data;

    if (!components.length) {
      return { content: [{ type: 'text', text: 'No components found matching your query.' }] };
    }

    const lines = components.map(c => {
      const catLabel = c.subcategory ? `${c.category}/${c.subcategory}` : c.category;
      let line = `• **${c.name}** (\`${c.slug}\`) — ${catLabel} · ${c.uses} uses · ${c.likes} likes`;
      if (c.source || c.group) line += `\n  Source: ${c.source || '—'} · Group: ${c.group || '—'}`;
      line += `\n  ${c.description || c.visual || ''}\n  Tags: ${(c.tags || []).join(', ')}`;
      return line;
    });

    return {
      content: [{
        type: 'text',
        text: `# Components (${total} total, page ${page}/${pages})\n\n${lines.join('\n\n')}\n\nUse \`get_component(slug)\` to get the full structure for any component.`,
      }],
    };
  },

  async get_component(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
    const c = data.component;

    return {
      content: [{
        type: 'text',
        text: `# ${c.name} (\`${c.slug}\`)\n\n**Category:** ${c.category}${c.source ? `\n**Source:** ${c.source}` : ''}${c.group ? `\n**Group:** ${c.group}` : ''}\n**Description:** ${c.description || ''}\n**Visual:** ${c.visual || ''}\n**Tags:** ${(c.tags || []).join(', ')}\n**Uses:** ${c.uses} · **Likes:** ${c.likes}\n\n## Structure\n\n\`\`\`json\n${JSON.stringify(c.structure, null, 2)}\n\`\`\``,
      }],
    };
  },

  async save_component(args) {
    const { name, slug, description, visual, category, subcategory, tags, source, group, structure, isPublic, isCategoryPreview } = args;
    if (!name || !slug || !category || !structure) {
      throw new Error('name, slug, category, and structure are required');
    }

    const data = await apiFetch('/api/v1/components', {
      method: 'POST',
      body: { name, slug, description, visual, category, subcategory, tags, source, group, structure, isPublic, isCategoryPreview },
    });

    return {
      content: [{
        type: 'text',
        text: `Component saved: **${data.component.name}** (\`${data.component.slug}\`)\nPublic: ${data.component.isPublic}\nCategory: ${data.component.category}`,
      }],
    };
  },

  async update_component(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');

    const body = {};
    const fields = ['name', 'description', 'visual', 'category', 'subcategory', 'tags', 'source', 'group', 'structure', 'isPublic', 'isFeatured', 'isCategoryPreview', 'newSlug'];
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
        text: `Component updated: **${c.name}** (\`${c.slug}\`)\nCategory: ${c.category}\nPublic: ${c.isPublic}`,
      }],
    };
  },

  async delete_component(args) {
    const { slug } = args;
    if (!slug) throw new Error('slug is required');
    await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: `Component "${slug}" deleted.` }] };
  },
};
