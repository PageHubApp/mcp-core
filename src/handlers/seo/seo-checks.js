const {
  collectNodes,
  GENERIC_LINK_TEXT,
  PLACEHOLDER_ALT,
} = require("../../validation/a11y-check");

const TEMPLATE_VAR = /\{\{.+?\}\}/;

function runChecks(siteData, nodes, pageId) {
  const results = [];
  const { texts, headings, images, buttons } = collectNodes(nodes, pageId);

  // Meta checks
  const title = siteData.title || siteData.name || "";
  if (!title.trim()) {
    results.push({
      id: "meta-title",
      status: "fail",
      message: "Missing site title",
      fix: "Set a descriptive page title (50-60 characters) via site settings.",
    });
  } else if (title.length < 20) {
    results.push({
      id: "meta-title",
      status: "warn",
      message: `Site title is short (${title.length} chars): "${title}"`,
      fix: "Aim for 50-60 characters with primary keywords.",
    });
  } else if (title.length > 70) {
    results.push({
      id: "meta-title",
      status: "warn",
      message: `Site title is long (${title.length} chars) — may be truncated in search results`,
      fix: "Keep under 60 characters.",
    });
  } else {
    results.push({
      id: "meta-title",
      status: "pass",
      message: `Title OK (${title.length} chars): "${title}"`,
    });
  }

  const description = siteData.description || "";
  if (!description.trim()) {
    results.push({
      id: "meta-description",
      status: "fail",
      message: "Missing meta description",
      fix: "Add a 150-160 character description summarizing the page content.",
    });
  } else if (description.length < 70) {
    results.push({
      id: "meta-description",
      status: "warn",
      message: `Meta description is short (${description.length} chars)`,
      fix: "Aim for 150-160 characters for best search result display.",
    });
  } else if (description.length > 170) {
    results.push({
      id: "meta-description",
      status: "warn",
      message: `Meta description is long (${description.length} chars) — may be truncated`,
      fix: "Keep under 160 characters.",
    });
  } else {
    results.push({
      id: "meta-description",
      status: "pass",
      message: `Description OK (${description.length} chars)`,
    });
  }

  const jsonLd = nodes.ROOT?.props?.seo?.jsonLd;
  if (!jsonLd || (typeof jsonLd === "object" && Object.keys(jsonLd).length === 0)) {
    results.push({
      id: "structured-data",
      status: "warn",
      message: "No structured data (JSON-LD) found",
      fix: "Add structured data via set_theme(jsonLd: {...}).",
    });
  } else {
    results.push({
      id: "structured-data",
      status: "pass",
      message: `Structured data present (@type: ${jsonLd["@type"] || "unknown"})`,
    });
  }

  // Heading hierarchy
  const h1s = headings.filter(h => h.level === 1);
  if (h1s.length === 0) {
    results.push({
      id: "h1-present",
      status: "fail",
      message: "No h1 heading found on page",
      fix: "Add exactly one h1 heading.",
    });
  } else if (h1s.length > 1) {
    results.push({
      id: "h1-present",
      status: "warn",
      message: `Multiple h1 headings found (${h1s.length})`,
      fix: "Use exactly one h1 per page.",
    });
  } else {
    results.push({
      id: "h1-present",
      status: "pass",
      message: `Single h1: "${h1s[0].text.substring(0, 60)}"`,
    });
  }

  if (headings.length > 1) {
    const skips = [];
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) {
        skips.push({
          from: `h${headings[i - 1].level}`,
          to: `h${headings[i].level}`,
          nodeId: headings[i].id,
        });
      }
    }
    if (skips.length > 0) {
      const detail = skips.map(s => `${s.from} → ${s.to} (${s.nodeId})`).join(", ");
      results.push({
        id: "heading-hierarchy",
        status: "warn",
        message: `Heading levels skipped: ${detail}`,
        fix: "Use sequential heading levels.",
      });
    } else {
      results.push({
        id: "heading-hierarchy",
        status: "pass",
        message: `Heading hierarchy is sequential (${headings.length} headings)`,
      });
    }
  }

  // Image checks
  const missingAlt = images.filter(img => !img.alt.trim());
  const badAlt = images.filter(img => img.alt.trim() && PLACEHOLDER_ALT.test(img.alt.trim()));
  if (missingAlt.length > 0) {
    results.push({
      id: "image-alt",
      status: "fail",
      message: `${missingAlt.length} image(s) missing alt text: ${missingAlt.map(i => i.id).join(", ")}`,
      fix: "Add descriptive alt text to all images.",
    });
  } else if (images.length > 0) {
    results.push({
      id: "image-alt",
      status: "pass",
      message: `All ${images.length} image(s) have alt text`,
    });
  }
  if (badAlt.length > 0) {
    results.push({
      id: "image-alt-quality",
      status: "warn",
      message: `${badAlt.length} image(s) with generic alt text`,
      fix: "Replace generic alt text with descriptive content.",
    });
  }

  // Button checks
  const genericButtons = buttons.filter(b => GENERIC_LINK_TEXT.test(b.text.trim()));
  if (genericButtons.length > 0) {
    results.push({
      id: "link-text",
      status: "warn",
      message: `${genericButtons.length} button(s) with generic text`,
      fix: "Use descriptive link text.",
    });
  } else if (buttons.length > 0) {
    results.push({
      id: "link-text",
      status: "pass",
      message: `All ${buttons.length} button(s) have descriptive text`,
    });
  }
  const emptyUrls = buttons.filter(b => !b.url.trim() || b.url === "#");
  if (emptyUrls.length > 0) {
    results.push({
      id: "link-url",
      status: "warn",
      message: `${emptyUrls.length} button(s) with empty or placeholder URLs`,
      fix: "Set real destination URLs.",
    });
  }

  // Content depth
  const wordCount = texts
    .map(t => t.text)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  if (wordCount < 50) {
    results.push({
      id: "content-depth",
      status: "warn",
      message: `Very thin content (${wordCount} words)`,
      fix: "Aim for at least 300 words on key pages.",
    });
  } else if (wordCount < 300) {
    results.push({
      id: "content-depth",
      status: "warn",
      message: `Light content (${wordCount} words)`,
      fix: "300+ words helps search ranking.",
    });
  } else {
    results.push({
      id: "content-depth",
      status: "pass",
      message: `Content depth OK (${wordCount} words)`,
    });
  }

  // Template variable check
  const templateNodes = texts.filter(t => TEMPLATE_VAR.test(t.text));
  if (templateNodes.length > 0) {
    results.push({
      id: "template-vars",
      status: "warn",
      message: `${templateNodes.length} text node(s) still have template variables`,
      fix: "Replace {{...}} placeholders with real content.",
    });
  }

  return results;
}

module.exports = { runChecks };
