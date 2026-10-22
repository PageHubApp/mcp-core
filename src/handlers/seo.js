/**
 * SEO + accessibility audit tools. The server renders the draft page as `/view` shows it and checks the HTML
 * (`GET /api/v1/sites/:id/audit`, app repo utils/htmlFirst/htmlAudit.ts, see ./seo/html-audit.js). Both tools return
 * a markdown report grouped by severity.
 */

const { auditHtmlSite } = require("./seo/html-audit");

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
   * Heuristic SEO checks against a page of the site's draft (the home page unless `pageId`).
   * @param {object} args - { id?, pageId? }
   */
  async audit_seo(args) {
    let html;
    try {
      html = await auditHtmlSite("seo", args);
    } catch (err) {
      return unavailable("SEO audit", err);
    }
    return seoReport(html.label, html.page, html.results);
  },

  /**
   * Static WCAG-style audit of a page of the site's draft, grouped by severity.
   * @param {object} args - { id?, pageId?, level? }
   */
  async audit_accessibility(args) {
    let html;
    try {
      html = await auditHtmlSite("accessibility", args);
    } catch (err) {
      return unavailable("Accessibility audit", err);
    }
    return a11yReport(html.label, html.page, html.results, "This is a static audit of the rendered draft page.");
  },
};
