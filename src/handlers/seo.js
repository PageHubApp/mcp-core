/**
 * SEO + accessibility audit tools. `audit_seo` runs heuristic SEO checks
 * (title length, meta description, heading hierarchy, alt text, etc.) and
 * `audit_accessibility` runs a static WCAG-style node-tree audit. Both
 * tools return a markdown report grouped by severity.
 */

const { apiFetch } = require("../core/api-fetch");
const { ROOT_NODE_ID } = require("../core/constants");

const { resolveRootId } = require("../validation/a11y-check");

const { runA11yChecks } = require("./seo/a11y-checks");
const { runChecks } = require("./seo/seo-checks");
const { loadAuditTarget } = require("./seo/target-loader");

module.exports = {
  /**
   * Run heuristic SEO checks against the active site/template's home page
   * (or a specific `pageId`) and return a markdown score report.
   * @param {object} args - { siteId?, templateSlug?, pageId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async audit_seo(args) {
    let data, nodes, label;

    try {
      const loaded = await loadAuditTarget(args);
      nodes = loaded.nodes;
      label = loaded.label;
      if (loaded.isTemplate) {
        const rootProps = nodes.ROOT?.props || {};
        data = {
          title: loaded.templateMeta.title || rootProps.title || "",
          description: loaded.templateMeta.description || rootProps.description || "",
          content: nodes,
        };
      } else {
        // Site-level title/description fall back to API metadata when not in
        // the node tree.
        let siteMeta = {};
        try {
          siteMeta = await apiFetch(`/api/v1/sites/${encodeURIComponent(loaded.siteId)}`);
        } catch {
          siteMeta = {};
        }
        data = { title: siteMeta.title, description: siteMeta.description, name: siteMeta.name };
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
        if (!pageId) pageId = nodes[ROOT_NODE_ID]?.nodes?.[0] || ROOT_NODE_ID;
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

  /**
   * Run a static WCAG-style node-tree audit and return a markdown report
   * grouped by severity (critical / serious / moderate / minor / pass).
   * @param {object} args - { siteId?, templateSlug?, pageId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async audit_accessibility(args) {
    // Node-based WCAG AA audit — checks the active site's node tree
    // (axe-core / URL auditing is not supported in build mode)
    let nodes, label;

    try {
      const loaded = await loadAuditTarget(args);
      nodes = loaded.nodes;
      label = loaded.label;
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

    const results = runA11yChecks(nodes, pageId);

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
