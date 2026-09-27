const { collectNodes, accessibleName } = require("../../validation/a11y-check");

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

  // Buttons: missing or generic accessible name. An icon-only button carrying
  // an `aria-label` is announced correctly — only one with neither is broken.
  const emptyBtns = buttons.filter(b => !accessibleName(b));
  if (emptyBtns.length > 0) {
    results.push({
      id: "button-text",
      severity: "critical",
      message: `${emptyBtns.length} button(s) have no accessible name — screen readers cannot identify them: ${emptyBtns.map(b => b.id).join(", ")}`,
      fix: 'Add descriptive text, or an attrs["aria-label"] for icon-only buttons.',
    });
  }
  const genericBtns = buttons.filter(b =>
    /^(click here|read more|learn more|here|link|more|submit|button)$/i.test(accessibleName(b))
  );
  if (genericBtns.length > 0) {
    results.push({
      id: "button-text-quality",
      severity: "moderate",
      message: `${genericBtns.length} button(s) use generic text ("${accessibleName(genericBtns[0])}")`,
      fix: "Use descriptive link text that makes sense out of context.",
    });
  } else if (buttons.length > 0 && emptyBtns.length === 0) {
    results.push({
      id: "button-text",
      severity: "pass",
      message: `All ${buttons.length} button(s) have an accessible name`,
    });
  }

  // Buttons: placeholder destinations. Behavioural actions and form submits
  // have no href by design and are not findings.
  const hashBtns = buttons.filter(
    b => (b.isNavigational && (!b.href || b.href === "#")) || b.isDead
  );
  if (hashBtns.length > 0) {
    results.push({
      id: "link-purpose",
      severity: "moderate",
      message: `${hashBtns.length} button(s) navigate nowhere: ${hashBtns.map(b => b.id).join(", ")}`,
      fix: "Set a real destination in props.action[].href, or remove the button.",
    });
  }

  // Nav landmark. Detect what actually renders a <nav>: `props.type: "nav"`
  // (pickContainerTag / Container.toHTML) or an explicit navigation role.
  // The previous check looked for `props.custom.isNav`, an MCP-only convention
  // with no SDK reference — it renders nothing, so this always reported a
  // missing landmark even on sites that had one.
  const hasNav = Object.values(nodes).some(n => {
    if (n?.type?.resolvedName !== "Container") return false;
    return n.props?.type === "nav" || n.props?.attrs?.role === "navigation";
  });
  if (!hasNav) {
    results.push({
      id: "nav-landmark",
      severity: "minor",
      message: "No navigation landmark detected",
      fix: 'Set props.type: "nav" on the header nav container (renders a real <nav>).',
    });
  }

  return results;
}

module.exports = { runA11yChecks };
