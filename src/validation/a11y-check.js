/**
 * Lightweight static a11y audit for CraftJS node trees.
 * Shared by save/update handlers (auto-check) and audit_accessibility (full report).
 */

const { ROOT_NODE_ID, HOME_PAGE_ID } = require("../core/constants");

const GENERIC_LINK_TEXT =
  /^(click here|read more|learn more|here|link|more|submit|button|download)$/i;
const PLACEHOLDER_ALT = /^(image|photo|picture|img|untitled|placeholder|alt text|screenshot)$/i;

/**
 * Action types that navigate somewhere and therefore need a destination.
 * `link` is the unified modern type; the rest are the legacy types the runtime
 * still shims. Every other action type (show-hide, set-state, add-to-cart,
 * toggle-theme, copy-to-clipboard, …) is behavioural and correctly has no href
 * — flagging those as "missing URL" is what made this check useless.
 */
const NAVIGATIONAL_ACTIONS = new Set([
  "link",
  "link-url",
  "link-page",
  "scroll-to",
  "email",
  "phone",
]);

/**
 * Resolve what a Button actually points at.
 *
 * Destinations live in `props.action[].href`. The legacy flat `props.url` is
 * NOT read by the renderer (`Button.body.tsx` declares it and never uses it),
 * so reading it reported every button on every modern site as broken.
 */
function resolveButtonDestination(props) {
  const raw = props?.action;
  const actions = Array.isArray(raw) ? raw : raw ? [raw] : [];
  // A form submit carries its role on `props.type` (the Button's own type prop);
  // `attrs.type` is the pass-through escape hatch. Either marks it as a button
  // whose job is submitting, not navigating.
  const isSubmit =
    String(props?.type || "").toLowerCase() === "submit" ||
    String(props?.attrs?.type || "").toLowerCase() === "submit";

  const nav = actions.filter(a => a && NAVIGATIONAL_ACTIONS.has(a.type));
  if (nav.length === 0) {
    // Behavioural actions (or a form submit) legitimately have no destination.
    // A button with NO action at all and no submit role goes nowhere and does
    // nothing — that one is a real finding.
    return { href: "", isNavigational: false, isDead: actions.length === 0 && !isSubmit };
  }
  const href = nav.map(a => String(a.href || "").trim()).find(Boolean) || "";
  return { href, isNavigational: true, isDead: false };
}

/** The name a screen reader announces: visible text, else `aria-label`. */
function accessibleName(btn) {
  return (btn.text || "").trim() || (btn.ariaLabel || "").trim();
}

/**
 * An icon-only button's label sits at the TOP level as `props["aria-label"]`
 * (that is what the Button renderer reads and ships); `attrs["aria-label"]` is
 * the generic pass-through and is also honoured. Reading only `attrs` reported
 * correctly-labelled carousel and menu buttons as unnamed.
 */
function readAriaLabel(props) {
  return String(props?.["aria-label"] || props?.attrs?.["aria-label"] || "");
}

function collectNodes(nodes, rootId) {
  const texts = [];
  const headings = [];
  const images = [];
  const buttons = [];

  const visited = new Set();
  const walk = id => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes[id];
    if (!node) return;
    const type = node.type?.resolvedName;
    if (type === "Text") {
      const text = node.props?.text || "";
      const tagName = node.props?.tagName || "p";
      texts.push({ id, text, tagName });
      if (/^h[1-6]$/.test(tagName)) {
        headings.push({ id, text, level: parseInt(tagName[1]) });
      }
    } else if (type === "Image") {
      images.push({
        id,
        alt: node.props?.alt || "",
        src: node.props?.content || node.props?.src || "",
      });
    } else if (type === "Button") {
      buttons.push({
        id,
        text: node.props?.text || "",
        ariaLabel: readAriaLabel(node.props),
        ...resolveButtonDestination(node.props),
      });
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
  if (nodes[HOME_PAGE_ID]) return HOME_PAGE_ID;
  for (const [id, node] of Object.entries(nodes)) {
    if (node?.props?.isHomePage && node?.props?.type === "page") return id;
  }
  if (nodes[ROOT_NODE_ID]?.nodes?.[0]) return nodes[ROOT_NODE_ID].nodes[0];
  if (nodes[ROOT_NODE_ID]) return ROOT_NODE_ID;
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
  if (!nodes || typeof nodes !== "object") return null;

  const root = resolveRootId(nodes, rootId);
  if (!root) return null;

  const { headings, images, buttons } = collectNodes(nodes, root);
  const issues = [];

  // Critical: images missing alt text
  const missingAlt = images.filter(img => !img.alt.trim());
  if (missingAlt.length > 0) {
    issues.push({
      id: "img-alt",
      severity: "critical",
      message: `${missingAlt.length} image(s) missing alt text: ${missingAlt.map(i => i.id).join(", ")}`,
      fix: 'Add descriptive alt text. Use alt="" only for purely decorative images.',
    });
  }

  // Serious: placeholder alt text
  const placeholderAlt = images.filter(
    img => img.alt.trim() && PLACEHOLDER_ALT.test(img.alt.trim())
  );
  if (placeholderAlt.length > 0) {
    issues.push({
      id: "img-alt-quality",
      severity: "serious",
      message: `${placeholderAlt.length} image(s) have placeholder alt text: ${placeholderAlt.map(i => `${i.id} ("${i.alt}")`).join(", ")}`,
      fix: "Replace with descriptive alt text that conveys the image content.",
    });
  }

  // Critical: buttons with no accessible name. An icon-only button with an
  // `aria-label` IS announced correctly — only a button with neither is broken.
  const emptyBtns = buttons.filter(b => !accessibleName(b));
  if (emptyBtns.length > 0) {
    issues.push({
      id: "button-text",
      severity: "critical",
      message: `${emptyBtns.length} button(s) have no accessible name — screen readers cannot identify them: ${emptyBtns.map(b => b.id).join(", ")}`,
      fix: 'Add descriptive text, or an attrs["aria-label"] for icon-only buttons.',
    });
  }

  // Moderate: generic link text
  const genericBtns = buttons.filter(b => GENERIC_LINK_TEXT.test(accessibleName(b)));
  if (genericBtns.length > 0) {
    issues.push({
      id: "button-text-quality",
      severity: "moderate",
      message: `${genericBtns.length} button(s) use generic text: ${genericBtns.map(b => `${b.id} ("${accessibleName(b)}")`).join(", ")}`,
      fix: "Use descriptive link text that makes sense out of context.",
    });
  }

  // Serious: no h1
  const h1s = headings.filter(h => h.level === 1);
  if (h1s.length === 0 && headings.length > 0) {
    issues.push({
      id: "heading-h1",
      severity: "serious",
      message: "No h1 heading — screen readers rely on h1 as the page landmark",
      fix: "Add exactly one h1 heading.",
    });
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
      issues.push({
        id: "heading-order",
        severity: "moderate",
        message: `Heading levels skipped: ${skips.join(", ")}`,
        fix: "Use sequential heading levels (h1 → h2 → h3, no skipping).",
      });
    }
  }

  if (issues.length === 0) return null;

  // Build summary
  const critical = issues.filter(i => i.severity === "critical");
  const serious = issues.filter(i => i.severity === "serious");
  const moderate = issues.filter(i => i.severity === "moderate");

  const lines = ["**Accessibility issues detected:**"];
  for (const issue of [...critical, ...serious, ...moderate]) {
    lines.push(`**${issue.severity}** — ${issue.message}`);
    lines.push(`  Fix: ${issue.fix}`);
  }

  return { issues, summary: lines.join("\n") };
}

module.exports = {
  collectNodes,
  resolveRootId,
  quickA11yAudit,
  resolveButtonDestination,
  accessibleName,
  readAriaLabel,
  GENERIC_LINK_TEXT,
  PLACEHOLDER_ALT,
  NAVIGATIONAL_ACTIONS,
};
