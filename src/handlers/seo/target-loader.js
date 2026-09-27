const { apiFetch } = require("../../core/api-fetch");
const { getActiveTarget, decodeContentOrThrow, fetchTarget } = require("../../helpers/index.js");

/**
 * Resolve the audit target (template or site) and load its node tree.
 *
 * Collapses the duplicated template-vs-site resolution that previously lived in
 * both audit_seo and audit_accessibility.
 *
 * Returns: { nodes, label, isTemplate, templateMeta }
 *   - nodes: the decoded flat node map
 *   - label: human-readable target label ("template:<slug>" or site id)
 *   - isTemplate: true if the audit target is a template
 *   - templateMeta: { title, description } from the template record (template only; null for sites)
 *
 * Throws on fetch/decode failures; callers wrap in try/catch and surface a
 * user-facing "audit unavailable" message.
 */
async function loadAuditTarget(args) {
  const isTemplateAudit =
    args.templateSlug ||
    (() => {
      try {
        return getActiveTarget(args).type === "template";
      } catch {
        return false;
      }
    })();

  if (isTemplateAudit) {
    const slug = args.templateSlug || getActiveTarget(args).id;
    const tpl = await apiFetch(`/api/v1/templates/${encodeURIComponent(slug)}`);
    if (!tpl.content) throw new Error(`Template "${slug}" has no content.`);
    const nodes = decodeContentOrThrow(tpl.content, `Template "${slug}" content`);
    return {
      nodes,
      label: `template:${slug}`,
      isTemplate: true,
      templateMeta: { title: tpl.title || "", description: tpl.description || "" },
    };
  }

  const target = getActiveTarget(args);
  // Use fetchTarget so we read the live in-progress draft
  // (ctx._pendingFlatMap) rather than stale DB content. Without this,
  // audits run mid-turn miss writes from update_page / set_theme /
  // patch_site_node and report fixed issues as still broken.
  const fetched = await fetchTarget(args);
  const nodes = fetched.flat;
  if (!nodes || typeof nodes !== "object") throw new Error("Site has no content.");
  return {
    nodes,
    label: target.id,
    isTemplate: false,
    templateMeta: null,
    siteId: target.id,
  };
}

module.exports = { loadAuditTarget };
