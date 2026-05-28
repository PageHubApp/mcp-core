const { collectNodes } = require("../../validation/a11y-check");

/**
 * Run a static node-tree WCAG AA-ish audit and return a flat list of results.
 *
 * Each result: { id, severity, message, fix? }
 *   severity ∈ "critical" | "serious" | "moderate" | "minor" | "pass"
 *
 * Pure: takes nodes + pageId, no network or context. Callers format the report.
 */
function runA11yChecks(nodes, pageId) {
  const { headings, images, buttons } = collectNodes(nodes, pageId);
  const results = [];

  // Images: missing alt
  const missingAlt = images.filter(img => !img.alt.trim());
  if (missingAlt.length > 0) {
    results.push({
      id: "img-alt",
      severity: "critical",
      message: `${missingAlt.length} image(s) missing alt text: ${missingAlt.map(i => i.id).join(", ")}`,
      fix: 'Add descriptive alt text. Use alt="" only for purely decorative images.',
    });
  } else if (images.length > 0) {
    results.push({
      id: "img-alt",
      severity: "pass",
      message: `All ${images.length} image(s) have alt text`,
    });
  }

  // Headings: single h1
  const h1s = headings.filter(h => h.level === 1);
  if (h1s.length === 0) {
    results.push({
      id: "heading-h1",
      severity: "serious",
      message: "No h1 heading — screen readers rely on h1 as the page landmark",
      fix: "Add exactly one h1 heading.",
    });
  } else if (h1s.length > 1) {
    results.push({
      id: "heading-h1",
      severity: "moderate",
      message: `${h1s.length} h1 headings — should be exactly one`,
      fix: "Use only one h1 per page.",
    });
  } else {
    results.push({
      id: "heading-h1",
      severity: "pass",
      message: `Single h1: "${h1s[0].text.substring(0, 60)}"`,
    });
  }

  // Heading order
  if (headings.length > 1) {
    const skips = [];
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) {
        skips.push(`h${headings[i - 1].level} → h${headings[i].level} (${headings[i].id})`);
      }
    }
    if (skips.length > 0) {
      results.push({
        id: "heading-order",
        severity: "moderate",
        message: `Heading levels skipped: ${skips.join(", ")}`,
        fix: "Use sequential heading levels (h1 → h2 → h3, no skipping).",
      });
    } else {
      results.push({
        id: "heading-order",
        severity: "pass",
        message: `Heading hierarchy is sequential`,
      });
    }
  }

  // Buttons: empty or generic text
  const emptyBtns = buttons.filter(b => !b.text.trim());
  if (emptyBtns.length > 0) {
    results.push({
      id: "button-text",
      severity: "critical",
      message: `${emptyBtns.length} button(s) have no text — screen readers cannot identify them`,
      fix: "Add descriptive text to all buttons.",
    });
  }
  const genericBtns = buttons.filter(b =>
    /^(click here|read more|learn more|here|link|more|submit|button)$/i.test(b.text.trim())
  );
  if (genericBtns.length > 0) {
    results.push({
      id: "button-text-quality",
      severity: "moderate",
      message: `${genericBtns.length} button(s) use generic text ("${genericBtns[0].text}")`,
      fix: "Use descriptive link text that makes sense out of context.",
    });
  } else if (buttons.length > 0 && emptyBtns.length === 0) {
    results.push({
      id: "button-text",
      severity: "pass",
      message: `All ${buttons.length} button(s) have descriptive text`,
    });
  }

  // Buttons: placeholder URLs
  const hashBtns = buttons.filter(b => !b.url.trim() || b.url === "#");
  if (hashBtns.length > 0) {
    results.push({
      id: "link-purpose",
      severity: "moderate",
      message: `${hashBtns.length} button(s) link to "#" or have no URL`,
      fix: "Set real destination URLs.",
    });
  }

  // Nav landmark
  const hasNav = Object.values(nodes).some(
    n => n.type?.resolvedName === "Container" && n.props?.custom?.isNav
  );
  if (!hasNav) {
    results.push({
      id: "nav-landmark",
      severity: "minor",
      message: "No navigation landmark detected",
      fix: 'Ensure the header nav container has role="navigation" or custom.isNav set.',
    });
  }

  return results;
}

module.exports = { runA11yChecks };
