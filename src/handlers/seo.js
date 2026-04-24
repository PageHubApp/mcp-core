const { apiFetch } = require("../api-fetch");
const { getActiveTarget, decodeContentOrThrow, fetchTarget } = require("../helpers");
const {
  collectNodes,
  resolveRootId,
  GENERIC_LINK_TEXT,
  PLACEHOLDER_ALT,
} = require("../a11y-check");

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

module.exports = {
  async audit_seo(args) {
    let data, nodes, label;

    // Resolve target: explicit templateSlug, or active target (site/template)
    const isTemplateAudit =
      args.templateSlug ||
      (() => {
        try {
          return getActiveTarget(args).type === "template";
        } catch {
          return false;
        }
      })();

    try {
      if (isTemplateAudit) {
        const slug = args.templateSlug || getActiveTarget(args).id;
        const tpl = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
        if (!tpl.content) throw new Error(`Template "${slug}" has no content.`);
        nodes = decodeContentOrThrow(tpl.content, `Template "${slug}" content`);
        const rootProps = nodes.ROOT?.props || {};
        data = {
          title: tpl.title || rootProps.title || "",
          description: tpl.description || rootProps.description || "",
          content: nodes,
        };
        label = `template:${slug}`;
      } else {
        const target = getActiveTarget(args);
        // Use fetchTarget so we read the live in-progress draft
        // (ctx._pendingFlatMap) rather than stale DB content. Without this,
        // audits run mid-turn miss writes from update_page / set_theme /
        // patch_site_node and report fixed issues as still broken.
        const fetched = await fetchTarget(args);
        nodes = fetched.flat;
        if (!nodes || typeof nodes !== "object") throw new Error("Site has no content.");
        // Site-level title/description fall back to API metadata when not in
        // the node tree.
        let siteMeta = {};
        try {
          siteMeta = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}`);
        } catch {
          siteMeta = {};
        }
        data = { title: siteMeta.title, description: siteMeta.description, name: siteMeta.name };
        label = target.id;
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `SEO audit unavailable: ${err.message}. The site data could not be fetched — try again after the build completes.`,
          },
        ],
      };
    }

    // Find the home page node — check page_home, then isHomePage flag, then first child of ROOT
    let pageId = args.pageId || null;
    if (!pageId) {
      if (nodes["page_home"]) {
        pageId = "page_home";
      } else {
        // Search for a node with isHomePage: true
        for (const [id, node] of Object.entries(nodes)) {
          if (node?.props?.isHomePage && node?.props?.type === "page") {
            pageId = id;
            break;
          }
        }
        if (!pageId) pageId = nodes.ROOT?.nodes?.[0] || "ROOT";
      }
    }
    if (!nodes[pageId])
      throw new Error(`Page "${pageId}" not found. Use list_pages to see available pages.`);

    // Page-level SEO (set via update_page) and ROOT title win over site-level
    // metadata. Without this merge, runChecks reads only siteData.title and
    // reports a freshly-set page title as missing.
    const pageSeo = nodes[pageId]?.props?.seo || {};
    const rootProps = nodes.ROOT?.props || {};
    const mergedData = {
      ...data,
      title: pageSeo.title || rootProps.title || data.title || data.name || "",
      description: pageSeo.description || rootProps.description || data.description || "",
    };
    const results = runChecks(mergedData, nodes, pageId);
    const fails = results.filter(r => r.status === "fail");
    const warns = results.filter(r => r.status === "warn");
    const passes = results.filter(r => r.status === "pass");
    const score = Math.round((passes.length / results.length) * 100);

    const lines = [`# SEO Audit — ${label} (${pageId})\n`];
    lines.push(
      `**Score: ${score}/100** — ${fails.length} critical, ${warns.length} warnings, ${passes.length} passed\n`
    );
    if (fails.length > 0) {
      lines.push(`## Critical Issues`);
      for (const r of fails) {
        lines.push(`- **${r.id}**: ${r.message}`);
        if (r.fix) lines.push(`  Fix: ${r.fix}`);
      }
      lines.push("");
    }
    if (warns.length > 0) {
      lines.push(`## Warnings`);
      for (const r of warns) {
        lines.push(`- **${r.id}**: ${r.message}`);
        if (r.fix) lines.push(`  Fix: ${r.fix}`);
      }
      lines.push("");
    }
    if (passes.length > 0) {
      lines.push(`## Passed`);
      for (const r of passes) lines.push(`- **${r.id}**: ${r.message}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },

  async audit_accessibility(args) {
    // Node-based WCAG AA audit — checks the active site's node tree
    // (axe-core / URL auditing is not supported in build mode)
    let nodes, label;

    const isTemplateAudit =
      args.templateSlug ||
      (() => {
        try {
          return getActiveTarget(args).type === "template";
        } catch {
          return false;
        }
      })();

    try {
      if (isTemplateAudit) {
        const slug = args.templateSlug || getActiveTarget(args).id;
        const tpl = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
        if (!tpl.content) throw new Error(`Template "${slug}" has no content.`);
        nodes = decodeContentOrThrow(tpl.content, `Template "${slug}" content`);
        label = `template:${slug}`;
      } else {
        const target = getActiveTarget(args);
        // fetchTarget reads ctx._pendingFlatMap first so audits see in-progress draft writes.
        const fetched = await fetchTarget(args);
        nodes = fetched.flat;
        if (!nodes || typeof nodes !== "object") throw new Error("Site has no content.");
        label = target.id;
      }
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Accessibility audit unavailable: ${err.message}. Try again after the build completes.`,
          },
        ],
      };
    }

    const pageId = resolveRootId(nodes, args.pageId);
    if (!pageId || !nodes[pageId])
      return { content: [{ type: "text", text: `Page "${args.pageId || "home"}" not found.` }] };

    const { texts, headings, images, buttons } = collectNodes(nodes, pageId);
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
      n =>
        n.type?.resolvedName === "Nav" ||
        (n.type?.resolvedName === "Container" && n.props?.custom?.isNav)
    );
    if (!hasNav) {
      results.push({
        id: "nav-landmark",
        severity: "minor",
        message: "No navigation landmark detected",
        fix: 'Ensure the header nav uses the Nav component or has role="navigation".',
      });
    }

    const critical = results.filter(r => r.severity === "critical");
    const serious = results.filter(r => r.severity === "serious");
    const moderate = results.filter(r => r.severity === "moderate");
    const minor = results.filter(r => r.severity === "minor");
    const passes = results.filter(r => r.severity === "pass");
    const issueCount = critical.length + serious.length + moderate.length + minor.length;
    const score = Math.round((passes.length / results.length) * 100);

    const lines = [`# Accessibility Audit — ${label} (${pageId})\n`];
    lines.push(
      `**Score: ${score}/100** — ${critical.length} critical, ${serious.length} serious, ${moderate.length} moderate, ${minor.length} minor, ${passes.length} passed\n`
    );
    lines.push(
      `> Note: This is a static node-tree audit. For full WCAG testing including color contrast and dynamic behavior, use a browser-based tool like axe DevTools.\n`
    );
    if (critical.length > 0) {
      lines.push("## Critical");
      for (const r of critical) {
        lines.push(`- **${r.id}**: ${r.message}`);
        if (r.fix) lines.push(`  Fix: ${r.fix}`);
      }
      lines.push("");
    }
    if (serious.length > 0) {
      lines.push("## Serious");
      for (const r of serious) {
        lines.push(`- **${r.id}**: ${r.message}`);
        if (r.fix) lines.push(`  Fix: ${r.fix}`);
      }
      lines.push("");
    }
    if (moderate.length > 0) {
      lines.push("## Moderate");
      for (const r of moderate) {
        lines.push(`- **${r.id}**: ${r.message}`);
        if (r.fix) lines.push(`  Fix: ${r.fix}`);
      }
      lines.push("");
    }
    if (minor.length > 0) {
      lines.push("## Minor");
      for (const r of minor) {
        lines.push(`- **${r.id}**: ${r.message}`);
        if (r.fix) lines.push(`  Fix: ${r.fix}`);
      }
      lines.push("");
    }
    if (passes.length > 0) {
      lines.push("## Passed");
      for (const r of passes) lines.push(`- **${r.id}**: ${r.message}`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
};
