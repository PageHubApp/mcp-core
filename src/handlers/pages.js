const { apiFetch, normalizeBaseUrl } = require('../api-fetch');
const { getContext } = require('../context');
const { parseMaybeJson } = require('../helpers');

function getActiveSiteId(args) {
  const ctx = getContext();
  const id = args.id || ctx.activeSite?.id;
  if (!id) throw new Error('No site id provided and no active site set.');
  return id;
}

/** Find all page nodes — direct ROOT children with props.type === 'page'. */
function findPages(flat) {
  const root = flat.ROOT;
  if (!root) return [];
  const pages = [];
  for (const childId of root.nodes || []) {
    const node = flat[childId];
    if (node && node.props?.type === 'page') {
      pages.push({ id: childId, node });
    }
  }
  return pages;
}

/** Slugify a display name to a URL path (simple lowercase + hyphens). */
function toSlug(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  async list_pages(args) {
    const siteId = getActiveSiteId(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
    if (!data.content) throw new Error('Site has no content.');
    const flat = data.content;
    const pages = findPages(flat);

    if (pages.length === 0) {
      return { content: [{ type: 'text', text: 'No pages found in this site.' }] };
    }

    const lines = pages.map((p, i) => {
      const props = p.node.props || {};
      const name = p.node.custom?.displayName || p.node.displayName || '(unnamed)';
      const slug = toSlug(name);
      const flags = [];
      if (props.isHomePage) flags.push('HOME');
      if (props.is404Page) flags.push('404');
      if (props.isHidden || p.node.hidden) flags.push('HIDDEN');
      const sectionCount = (p.node.nodes || []).length;
      const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
      return `${i + 1}. **${p.id}** — "${name}" (/${slug}, ${sectionCount} sections)${flagStr}`;
    });

    return {
      content: [{
        type: 'text',
        text: `# Pages in site ${siteId}\n\n${lines.join('\n')}\n\nUse pageId with add_section, add_custom_section, or update_page.`,
      }],
    };
  },

  async add_page(args) {
    const { name, isHomePage, is404Page, position } = args;
    if (!name) throw new Error('Page name is required.');

    const siteId = getActiveSiteId(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
    if (!data.content) throw new Error('Site has no content.');
    const flat = JSON.parse(JSON.stringify(data.content));
    const root = flat.ROOT;
    if (!root) throw new Error('Site has no ROOT node.');

    const pages = findPages(flat);
    const slug = toSlug(name);
    const pageId = `page_${slug.replace(/-/g, '_')}`;
    if (flat[pageId]) throw new Error(`Node ID "${pageId}" already exists. Choose a different page name.`);

    // Build SEO props from args
    const seo = parseMaybeJson(args.seo) || {};
    const seoProps = {};
    for (const key of ['pageTitle', 'pageDescription', 'pageKeywords', 'ogTitle', 'ogDescription', 'ogImage', 'ogType', 'canonicalUrl', 'robots']) {
      if (seo[key] != null) seoProps[key] = seo[key];
    }

    // Determine home page flag
    const shouldBeHome = isHomePage === true || pages.length === 0;

    // If this becomes home page, unset the flag on the current one
    if (shouldBeHome) {
      for (const p of pages) {
        if (p.node.props?.isHomePage) {
          p.node.props.isHomePage = false;
        }
      }
    }

    // Create the page node
    flat[pageId] = {
      type: { resolvedName: 'Container' },
      isCanvas: true,
      props: {
        canDelete: true,
        canEditName: true,
        type: 'page',
        root: {},
        mobile: { display: 'flex', flexDirection: 'flex-col', width: 'w-full' },
        desktop: {},
        ...(shouldBeHome ? { isHomePage: true } : {}),
        ...(is404Page === true ? { is404Page: true } : {}),
        ...seoProps,
      },
      displayName: 'Container',
      custom: { displayName: name },
      parent: 'ROOT',
      hidden: false,
      nodes: [],
      linkedNodes: {},
    };

    // Insert into ROOT.nodes — before footer if no explicit position
    const rootNodes = root.nodes || (root.nodes = []);
    let insertPos;
    if (position != null) {
      insertPos = position;
    } else {
      // Find the last page node index, insert after it
      let lastPageIdx = -1;
      for (let i = 0; i < rootNodes.length; i++) {
        const n = flat[rootNodes[i]];
        if (n && n.props?.type === 'page') lastPageIdx = i;
      }
      insertPos = lastPageIdx >= 0 ? lastPageIdx + 1 : rootNodes.length;
    }
    rootNodes.splice(insertPos, 0, pageId);

    const ctx = getContext();

    // Support batched mode (agent endpoint)
    if (ctx._batchMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [{ type: 'text', text: `Page "${name}" created as ${pageId} (/${slug}).` }],
        pendingContent: flat,
      };
    }

    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, { method: 'PUT', body: { content: flat } });
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
    return {
      content: [{
        type: 'text',
        text: `Page "${name}" created as ${pageId} (/${slug}).${shouldBeHome ? ' Marked as home page.' : ''}\nEditor: ${base}/build/${put.id}`,
      }],
    };
  },

  async update_page(args) {
    const { pageId, name, isHomePage, is404Page, isHidden } = args;
    if (!pageId) throw new Error('pageId is required.');

    const siteId = getActiveSiteId(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
    if (!data.content) throw new Error('Site has no content.');
    const flat = JSON.parse(JSON.stringify(data.content));

    const page = flat[pageId];
    if (!page) throw new Error(`Page node "${pageId}" not found.`);
    if (page.props?.type !== 'page') throw new Error(`Node "${pageId}" is not a page (type: ${page.props?.type || 'unknown'}).`);

    const changes = [];

    // Update display name
    if (name != null) {
      if (!page.custom) page.custom = {};
      page.custom.displayName = name;
      changes.push(`name → "${name}" (/${toSlug(name)})`);
    }

    // Update home page flag
    if (isHomePage === true) {
      const pages = findPages(flat);
      for (const p of pages) {
        if (p.node.props?.isHomePage) p.node.props.isHomePage = false;
      }
      page.props.isHomePage = true;
      changes.push('isHomePage → true');
    } else if (isHomePage === false) {
      page.props.isHomePage = false;
      changes.push('isHomePage → false');
    }

    // Update 404 flag
    if (is404Page != null) {
      page.props.is404Page = is404Page;
      changes.push(`is404Page → ${is404Page}`);
    }

    // Update visibility
    if (isHidden != null) {
      page.props.isHidden = isHidden;
      page.hidden = isHidden;
      changes.push(`isHidden → ${isHidden}`);
    }

    // Update SEO
    const seo = parseMaybeJson(args.seo) || {};
    for (const key of ['pageTitle', 'pageDescription', 'pageKeywords', 'ogTitle', 'ogDescription', 'ogImage', 'ogType', 'canonicalUrl', 'robots']) {
      if (seo[key] != null) {
        page.props[key] = seo[key];
        changes.push(`${key} → "${seo[key]}"`);
      }
    }

    if (changes.length === 0) {
      return { content: [{ type: 'text', text: 'No changes specified.' }] };
    }

    const ctx = getContext();
    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, { method: 'PUT', body: { content: flat } });
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
    return {
      content: [{
        type: 'text',
        text: `Page ${pageId} updated:\n  ${changes.join('\n  ')}\nEditor: ${base}/build/${put.id}`,
      }],
    };
  },

  async delete_page(args) {
    const { pageId } = args;
    if (!pageId) throw new Error('pageId is required.');

    const siteId = getActiveSiteId(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
    if (!data.content) throw new Error('Site has no content.');
    const flat = JSON.parse(JSON.stringify(data.content));

    const page = flat[pageId];
    if (!page) throw new Error(`Page node "${pageId}" not found.`);
    if (page.props?.type !== 'page') throw new Error(`Node "${pageId}" is not a page (type: ${page.props?.type || 'unknown'}).`);

    const pages = findPages(flat);
    if (pages.length <= 1) throw new Error('Cannot delete the last page. A site must have at least one page.');

    const wasHomePage = page.props?.isHomePage === true;
    const pageName = page.custom?.displayName || page.displayName || pageId;

    // Remove from ROOT.nodes
    const root = flat.ROOT;
    if (root) {
      root.nodes = (root.nodes || []).filter(id => id !== pageId);
    }

    // Delete the page and all descendants
    const deleteSubtree = (id) => {
      const n = flat[id];
      if (!n) return;
      for (const child of [...(n.nodes || [])]) deleteSubtree(child);
      delete flat[id];
    };
    deleteSubtree(pageId);

    // If we deleted the home page, promote the first remaining page
    let promotedPage = null;
    if (wasHomePage) {
      const remaining = findPages(flat);
      if (remaining.length > 0) {
        remaining[0].node.props.isHomePage = true;
        promotedPage = remaining[0].id;
      }
    }

    const ctx = getContext();
    const put = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, { method: 'PUT', body: { content: flat } });
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
    const promoMsg = promotedPage ? ` ${promotedPage} promoted to home page.` : '';
    return {
      content: [{
        type: 'text',
        text: `Page "${pageName}" (${pageId}) deleted.${promoMsg}\nEditor: ${base}/build/${put.id}`,
      }],
    };
  },
};
