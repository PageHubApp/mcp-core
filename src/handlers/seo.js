const { apiFetch } = require('../api-fetch');
const { getActiveSiteId } = require('../helpers');

const GENERIC_LINK_TEXT = /^(click here|read more|learn more|here|link|more|submit|button|download)$/i;
const PLACEHOLDER_ALT = /^(image|photo|picture|img|untitled|placeholder|alt text|screenshot)$/i;
const TEMPLATE_VAR = /\{\{.+?\}\}/;

function collectNodes(nodes, pageId) {
  const texts = [];
  const headings = [];
  const images = [];
  const buttons = [];

  const visited = new Set();
  const walk = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes[id];
    if (!node) return;
    const type = node.type?.resolvedName;
    if (type === 'Text') {
      const text = node.props?.text || '';
      const tagName = node.props?.tagName || 'p';
      texts.push({ id, text, tagName });
      if (/^h[1-6]$/.test(tagName)) {
        headings.push({ id, text, level: parseInt(tagName[1]) });
      }
    } else if (type === 'Image') {
      images.push({ id, alt: node.props?.alt || '', src: node.props?.content || node.props?.src || '' });
    } else if (type === 'Button') {
      buttons.push({ id, text: node.props?.text || '', url: node.props?.url || '' });
    }
    for (const childId of node.nodes || []) walk(childId);
    // Also walk linkedNodes (used by Nav, multi-page templates)
    if (node.linkedNodes) {
      for (const linkedId of Object.values(node.linkedNodes)) walk(linkedId);
    }
  };
  walk(pageId);
  return { texts, headings, images, buttons };
}

function runChecks(siteData, nodes, pageId) {
  const results = [];
  const { texts, headings, images, buttons } = collectNodes(nodes, pageId);

  // Meta checks
  const title = siteData.title || siteData.name || '';
  if (!title.trim()) {
    results.push({ id: 'meta-title', status: 'fail', message: 'Missing site title', fix: 'Set a descriptive page title (50-60 characters) via site settings.' });
  } else if (title.length < 20) {
    results.push({ id: 'meta-title', status: 'warn', message: `Site title is short (${title.length} chars): "${title}"`, fix: 'Aim for 50-60 characters with primary keywords.' });
  } else if (title.length > 70) {
    results.push({ id: 'meta-title', status: 'warn', message: `Site title is long (${title.length} chars) — may be truncated in search results`, fix: 'Keep under 60 characters.' });
  } else {
    results.push({ id: 'meta-title', status: 'pass', message: `Title OK (${title.length} chars): "${title}"` });
  }

  const description = siteData.description || '';
  if (!description.trim()) {
    results.push({ id: 'meta-description', status: 'fail', message: 'Missing meta description', fix: 'Add a 150-160 character description summarizing the page content.' });
  } else if (description.length < 70) {
    results.push({ id: 'meta-description', status: 'warn', message: `Meta description is short (${description.length} chars)`, fix: 'Aim for 150-160 characters for best search result display.' });
  } else if (description.length > 170) {
    results.push({ id: 'meta-description', status: 'warn', message: `Meta description is long (${description.length} chars) — may be truncated`, fix: 'Keep under 160 characters.' });
  } else {
    results.push({ id: 'meta-description', status: 'pass', message: `Description OK (${description.length} chars)` });
  }

  const jsonLd = nodes.ROOT?.props?.jsonLd;
  if (!jsonLd || (typeof jsonLd === 'object' && Object.keys(jsonLd).length === 0)) {
    results.push({ id: 'structured-data', status: 'warn', message: 'No structured data (JSON-LD) found', fix: 'Add structured data via set_theme(jsonLd: {...}).' });
  } else {
    results.push({ id: 'structured-data', status: 'pass', message: `Structured data present (@type: ${jsonLd['@type'] || 'unknown'})` });
  }

  // Heading hierarchy
  const h1s = headings.filter(h => h.level === 1);
  if (h1s.length === 0) {
    results.push({ id: 'h1-present', status: 'fail', message: 'No h1 heading found on page', fix: 'Add exactly one h1 heading.' });
  } else if (h1s.length > 1) {
    results.push({ id: 'h1-present', status: 'warn', message: `Multiple h1 headings found (${h1s.length})`, fix: 'Use exactly one h1 per page.' });
  } else {
    results.push({ id: 'h1-present', status: 'pass', message: `Single h1: "${h1s[0].text.substring(0, 60)}"` });
  }

  if (headings.length > 1) {
    const skips = [];
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) {
        skips.push({ from: `h${headings[i - 1].level}`, to: `h${headings[i].level}`, nodeId: headings[i].id });
      }
    }
    if (skips.length > 0) {
      const detail = skips.map(s => `${s.from} → ${s.to} (${s.nodeId})`).join(', ');
      results.push({ id: 'heading-hierarchy', status: 'warn', message: `Heading levels skipped: ${detail}`, fix: 'Use sequential heading levels.' });
    } else {
      results.push({ id: 'heading-hierarchy', status: 'pass', message: `Heading hierarchy is sequential (${headings.length} headings)` });
    }
  }

  // Image checks
  const missingAlt = images.filter(img => !img.alt.trim());
  const badAlt = images.filter(img => img.alt.trim() && PLACEHOLDER_ALT.test(img.alt.trim()));
  if (missingAlt.length > 0) {
    results.push({ id: 'image-alt', status: 'fail', message: `${missingAlt.length} image(s) missing alt text: ${missingAlt.map(i => i.id).join(', ')}`, fix: 'Add descriptive alt text to all images.' });
  } else if (images.length > 0) {
    results.push({ id: 'image-alt', status: 'pass', message: `All ${images.length} image(s) have alt text` });
  }
  if (badAlt.length > 0) {
    results.push({ id: 'image-alt-quality', status: 'warn', message: `${badAlt.length} image(s) with generic alt text`, fix: 'Replace generic alt text with descriptive content.' });
  }

  // Button checks
  const genericButtons = buttons.filter(b => GENERIC_LINK_TEXT.test(b.text.trim()));
  if (genericButtons.length > 0) {
    results.push({ id: 'link-text', status: 'warn', message: `${genericButtons.length} button(s) with generic text`, fix: 'Use descriptive link text.' });
  } else if (buttons.length > 0) {
    results.push({ id: 'link-text', status: 'pass', message: `All ${buttons.length} button(s) have descriptive text` });
  }
  const emptyUrls = buttons.filter(b => !b.url.trim() || b.url === '#');
  if (emptyUrls.length > 0) {
    results.push({ id: 'link-url', status: 'warn', message: `${emptyUrls.length} button(s) with empty or placeholder URLs`, fix: 'Set real destination URLs.' });
  }

  // Content depth
  const wordCount = texts.map(t => t.text).join(' ').split(/\s+/).filter(Boolean).length;
  if (wordCount < 50) {
    results.push({ id: 'content-depth', status: 'warn', message: `Very thin content (${wordCount} words)`, fix: 'Aim for at least 300 words on key pages.' });
  } else if (wordCount < 300) {
    results.push({ id: 'content-depth', status: 'warn', message: `Light content (${wordCount} words)`, fix: '300+ words helps search ranking.' });
  } else {
    results.push({ id: 'content-depth', status: 'pass', message: `Content depth OK (${wordCount} words)` });
  }

  // Template variable check
  const templateNodes = texts.filter(t => TEMPLATE_VAR.test(t.text));
  if (templateNodes.length > 0) {
    results.push({ id: 'template-vars', status: 'warn', message: `${templateNodes.length} text node(s) still have template variables`, fix: 'Replace {{...}} placeholders with real content.' });
  }

  return results;
}

module.exports = {
  async audit_seo(args) {
    let data, nodes, label;

    if (args.templateSlug) {
      // Audit a template by slug
      const tpl = await apiFetch(`/api/v1/templates/${encodeURIComponent(args.templateSlug)}`);
      if (!tpl.content) throw new Error(`Template "${args.templateSlug}" has no content.`);
      nodes = tpl.content;
      const rootProps = nodes.ROOT?.props || {};
      data = {
        title: tpl.title || rootProps.title || '',
        description: tpl.description || rootProps.description || '',
        content: nodes,
      };
      label = `template:${args.templateSlug}`;
    } else {
      // Audit a live site by id
      const siteId = getActiveSiteId(args);
      data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);
      if (!data.content) throw new Error('Site has no content.');
      nodes = data.content;
      label = siteId;
    }

    // Find the home page node — templates use the first child of ROOT
    const pageId = args.pageId || (nodes['page_home'] ? 'page_home' : (nodes.ROOT?.nodes?.[0] || 'ROOT'));
    if (!nodes[pageId]) throw new Error(`Page "${pageId}" not found. Use list_pages to see available pages.`);

    const results = runChecks(data, nodes, pageId);
    const fails = results.filter(r => r.status === 'fail');
    const warns = results.filter(r => r.status === 'warn');
    const passes = results.filter(r => r.status === 'pass');
    const score = Math.round((passes.length / results.length) * 100);

    const lines = [`# SEO Audit — ${label} (${pageId})\n`];
    lines.push(`**Score: ${score}/100** — ${fails.length} critical, ${warns.length} warnings, ${passes.length} passed\n`);
    if (fails.length > 0) {
      lines.push(`## Critical Issues`);
      for (const r of fails) { lines.push(`- **${r.id}**: ${r.message}`); if (r.fix) lines.push(`  Fix: ${r.fix}`); }
      lines.push('');
    }
    if (warns.length > 0) {
      lines.push(`## Warnings`);
      for (const r of warns) { lines.push(`- **${r.id}**: ${r.message}`); if (r.fix) lines.push(`  Fix: ${r.fix}`); }
      lines.push('');
    }
    if (passes.length > 0) {
      lines.push(`## Passed`);
      for (const r of passes) lines.push(`- **${r.id}**: ${r.message}`);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
};
