/**
 * SEO + accessibility audit tools. `audit_seo` runs heuristic SEO checks
 * (title length, meta description, heading hierarchy, alt text, etc.) and
 * `audit_accessibility` runs a static WCAG-style audit. On a Craft site both
 * check the node tree; on an HTML-first site the server checks the rendered
 * draft page (seo/html-audit.js). Both return a markdown report grouped by
 * severity.
 */

const { apiFetch } = require("../core/api-fetch");
const { ROOT_NODE_ID } = require("../core/constants");
const { isSiteIsHtmlError } = require("../data/site-formats");

const { resolveRootId } = require("../validation/a11y-check");

const { runA11yChecks } = require("./seo/a11y-checks");
const { auditHtmlSite } = require("./seo/html-audit");
const { runChecks } = require("./seo/seo-checks");
const { loadAuditTarget } = require("./seo/target-loader");

/** `## Heading` + one bullet (and fix) per result; nothing when the group is empty. */
function group(lines, heading, results, withFix = true) {
  if (!results.length) return;
  lines.push(`## ${heading}`);
  for (const r of results) {
    lines.push(`- **${r.id}**: ${r.message}`);
    if (withFix && r.fix) lines.push(`  Fix: ${r.fix}`);
  }
  lines.push("");
}

function seoReport(label, pageId, results) {
  const fails = results.filter(r => r.status === "fail");
  const warns = results.filter(r => r.status === "warn");
  const passes = results.filter(r => r.status === "pass");
  const score = Math.round((passes.length / results.length) * 100);
  const lines = [`# SEO Audit — ${label} (${pageId})\n`];
  lines.push(`**Score: ${score}/100** — ${fails.length} critical, ${warns.length} warnings, ${passes.length} passed\n`);
  group(lines, "Critical Issues", fails);
  group(lines, "Warnings", warns);
  group(lines, "Passed", passes, false);
  return { content: [{ type: "text", text: lines.join("\n").trimEnd() }] };
}

function a11yReport(label, pageId, results, note) {
  const by = s => results.filter(r => r.severity === s);
  const [critical, serious, moderate, minor, passes] = ["critical", "serious", "moderate", "minor", "pass"].map(by);
  const score = Math.round((passes.length / results.length) * 100);
  const lines = [`# Accessibility Audit — ${label} (${pageId})\n`];
  lines.push(
    `**Score: ${score}/100** — ${critical.length} critical, ${serious.length} serious, ${moderate.length} moderate, ${minor.length} minor, ${passes.length} passed\n`
  );
  lines.push(`> Note: ${note} For full WCAG testing including color contrast and dynamic behavior, use a browser-based tool like axe DevTools.\n`);
  group(lines, "Critical", critical);
  group(lines, "Serious", serious);
  group(lines, "Moderate", moderate);
  group(lines, "Minor", minor);
  group(lines, "Passed", passes, false);
  return { content: [{ type: "text", text: lines.join("\n").trimEnd() }] };
}

const unavailable = (what, err) => ({
  content: [{ type: "text", text: `${what} unavailable: ${err.message}. The site data could not be fetched — try again after the build completes.` }],
});

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
      if (isSiteIsHtmlError(err)) {
        const html = await auditHtmlSite("seo", args);
        return seoReport(html.label, html.page, html.results);
      }
      return unavailable("SEO audit", err);
    }

    // Find the home page node — check page_home, then isHomePage flag, then first child of ROOT
    let pageId = args.pageId || null;
    if (!pageId) {
      if (nodes["page_home"]) {
        pageId = "page_home";
      } else {
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
    return seoReport(label, pageId, runChecks(mergedData, nodes, pageId));
  },

  /**
   * Run a static WCAG-style audit and return a markdown report grouped by
   * severity (critical / serious / moderate / minor / pass).
   * @param {object} args - { siteId?, templateSlug?, pageId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async audit_accessibility(args) {
    let nodes, label;

    try {
      const loaded = await loadAuditTarget(args);
      nodes = loaded.nodes;
      label = loaded.label;
    } catch (err) {
      if (isSiteIsHtmlError(err)) {
        const html = await auditHtmlSite("accessibility", args);
        return a11yReport(html.label, html.page, html.results, "This is a static audit of the rendered draft page.");
      }
      return unavailable("Accessibility audit", err);
    }

    const pageId = resolveRootId(nodes, args.pageId);
    if (!pageId || !nodes[pageId])
      return { content: [{ type: "text", text: `Page "${args.pageId || "home"}" not found.` }] };

    return a11yReport(label, pageId, runA11yChecks(nodes, pageId), "This is a static node-tree audit.");
  },
};
