/**
 * `audit_seo` / `audit_accessibility` on an HTML-first site: the server renders the draft page as `/view` shows it and
 * checks the HTML (`GET /api/v1/sites/:id/audit`, app repo utils/htmlFirst/htmlAudit.ts). Results have the same
 * shape as the node-tree checks, so seo.js formats both the same way.
 */
const { apiFetch } = require("../../core/api-fetch");
const { getActiveTarget } = require("../../helpers/target");

/** The page's URL path: `pageId` from list_pages, or home. */
async function pathOf(siteId, pageId) {
  if (!pageId) return "/";
  const { pages } = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/source-pages`);
  const page = (pages || []).find(p => p.pageId === pageId);
  if (!page) throw new Error(`Page "${pageId}" not found. Use list_pages to see available pages.`);
  if (page.pathPattern) throw new Error(`Page "${pageId}" is a detail page (${page.url}); audit one of its rows with screenshot_site or a list page instead.`);
  return page.url;
}

/** @param {"seo" | "accessibility"} kind */
async function auditHtmlSite(kind, args) {
  const siteId = getActiveTarget(args).id;
  const path = await pathOf(siteId, args.pageId);
  const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/audit?${new URLSearchParams({ kind, path })}`);
  return { label: siteId, page: path, results: data.results || [] };
}

module.exports = { auditHtmlSite };
