/**
 * Lightweight static a11y audit for CraftJS node trees.
 * Shared by save/update handlers (auto-check) and audit_accessibility (full report).
 */

const GENERIC_LINK_TEXT = /^(click here|read more|learn more|here|link|more|submit|button|download)$/i;
const PLACEHOLDER_ALT = /^(image|photo|picture|img|untitled|placeholder|alt text|screenshot)$/i;

function collectNodes(nodes, rootId) {
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
    if (node.linkedNodes) {
      for (const linkedId of Object.values(node.linkedNodes)) walk(linkedId);
    }
  };
  walk(rootId);
  return { texts, headings, images, buttons };
}

/**
 * Resolve the root node ID for auditing.
 * Tries: explicit rootId → page_home → first isHomePage page → ROOT's first child → ROOT → first key.
 */
function resolveRootId(nodes, rootId) {
  if (rootId && nodes[rootId]) return rootId;
  if (nodes['page_home']) return 'page_home';
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.props?.isHomePage && node?.props?.type === 'page') return id;
  }
  if (nodes.ROOT?.nodes?.[0]) return nodes.ROOT.nodes[0];
  if (nodes.ROOT) return 'ROOT';
  return Object.keys(nodes)[0] || null;
}

/**
 * Run a quick static a11y audit on a node tree.
 * @param {object} nodes - CraftJS flat node map
 * @param {string} [rootId] - optional root node ID (auto-detected if omitted)
 * @returns {{ issues: Array<{id: string, severity: string, message: string, fix: string}>, summary: string } | null}
 *   Returns null if no issues found.
 */
function quickA11yAudit(nodes, rootId) {
  if (!nodes || typeof nodes !== 'object') return null;

  const root = resolveRootId(nodes, rootId);
  if (!root) return null;

  const { headings, images, buttons } = collectNodes(nodes, root);
  const issues = [];

  // Critical: images missing alt text
  const missingAlt = images.filter(img => !img.alt.trim());
  if (missingAlt.length > 0) {
    issues.push({ id: 'img-alt', severity: 'critical', message: `${missingAlt.length} image(s) missing alt text: ${missingAlt.map(i => i.id).join(', ')}`, fix: 'Add descriptive alt text. Use alt="" only for purely decorative images.' });
  }

  // Serious: placeholder alt text
  const placeholderAlt = images.filter(img => img.alt.trim() && PLACEHOLDER_ALT.test(img.alt.trim()));
  if (placeholderAlt.length > 0) {
    issues.push({ id: 'img-alt-quality', severity: 'serious', message: `${placeholderAlt.length} image(s) have placeholder alt text: ${placeholderAlt.map(i => `${i.id} ("${i.alt}")`).join(', ')}`, fix: 'Replace with descriptive alt text that conveys the image content.' });
  }

  // Critical: buttons with no text
  const emptyBtns = buttons.filter(b => !b.text.trim());
  if (emptyBtns.length > 0) {
    issues.push({ id: 'button-text', severity: 'critical', message: `${emptyBtns.length} button(s) have no text — screen readers cannot identify them: ${emptyBtns.map(b => b.id).join(', ')}`, fix: 'Add descriptive text to all buttons.' });
  }

  // Moderate: generic link text
  const genericBtns = buttons.filter(b => GENERIC_LINK_TEXT.test(b.text.trim()));
  if (genericBtns.length > 0) {
    issues.push({ id: 'button-text-quality', severity: 'moderate', message: `${genericBtns.length} button(s) use generic text: ${genericBtns.map(b => `${b.id} ("${b.text}")`).join(', ')}`, fix: 'Use descriptive link text that makes sense out of context.' });
  }

  // Serious: no h1
  const h1s = headings.filter(h => h.level === 1);
  if (h1s.length === 0 && headings.length > 0) {
    issues.push({ id: 'heading-h1', severity: 'serious', message: 'No h1 heading — screen readers rely on h1 as the page landmark', fix: 'Add exactly one h1 heading.' });
  }

  // Moderate: heading hierarchy skips
  if (headings.length > 1) {
    const skips = [];
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) {
        skips.push(`h${headings[i - 1].level} → h${headings[i].level}`);
      }
    }
    if (skips.length > 0) {
      issues.push({ id: 'heading-order', severity: 'moderate', message: `Heading levels skipped: ${skips.join(', ')}`, fix: 'Use sequential heading levels (h1 → h2 → h3, no skipping).' });
    }
  }

  if (issues.length === 0) return null;

  // Build summary
  const critical = issues.filter(i => i.severity === 'critical');
  const serious = issues.filter(i => i.severity === 'serious');
  const moderate = issues.filter(i => i.severity === 'moderate');

  const lines = ['⚠️ **Accessibility issues detected:**'];
  for (const issue of [...critical, ...serious, ...moderate]) {
    const badge = issue.severity === 'critical' ? '🔴' : issue.severity === 'serious' ? '🟠' : '🟡';
    lines.push(`${badge} **${issue.severity}** — ${issue.message}`);
    lines.push(`  Fix: ${issue.fix}`);
  }

  return { issues, summary: lines.join('\n') };
}

module.exports = { collectNodes, resolveRootId, quickA11yAudit, GENERIC_LINK_TEXT, PLACEHOLDER_ALT };
