/**
 * `list_pages` / `add_page` / `update_page` / `delete_page` on an HTML-first site: a page is a record (route, SEO,
 * flags) plus its file, served by `/api/v1/sites/:id/source-pages` (app repo: docs/features/html-first-ai-mcp.md).
 * handlers/pages.js tries the node-tree path first and comes here when the site answers `SITE_IS_HTML`.
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget, getEditorUrl } = require("../helpers/target");

const text = t => ({ content: [{ type: "text", text: t }] });
const pagesUrl = (siteId, pageId) =>
  `/api/v1/sites/${encodeURIComponent(siteId)}/source-pages${pageId ? `/${encodeURIComponent(pageId)}` : ""}`;

/** Node-tree-only fields of update_page, and what to do instead on an HTML-first site. */
const FILE_FIELDS = {
  headCode: "a tag in the page file's <head> (third-party code: site.json inject)",
  footerCode: "the end of the page file's <body>",
  bodyClass: "the class on the page file's <body>",
  hideHeader: "removing {% render 'header' %} from the page file",
  hideFooter: "removing {% render 'footer' %} from the page file",
  hideChrome: "removing the {% render %} partials from the page file",
};

async function call(url, opts) {
  try {
    return await apiFetch(url, opts);
  } catch (err) {
    const b = err?.body || {};
    if (b.error === "lint") {
      const issues = (b.issues || []).slice(0, 8).map(i => `  - [${i.rule}] ${i.message}`).join("\n");
      throw new Error(`The page file was NOT saved: it breaks the HTML-first rules.\n${issues}`);
    }
    if (b.message) throw new Error(b.message);
    throw err;
  }
}

function line(p, i) {
  const flags = [p.isHomePage && "HOME", p.is404Page && "404", p.isHidden && "HIDDEN"].filter(Boolean);
  return `${i + 1}. **${p.pageId}** — "${p.name || "(unnamed)"}" (${p.url}, file ${p.file || "none"})${flags.length ? ` [${flags.join(", ")}]` : ""}`;
}

module.exports = {
  async list(args) {
    const siteId = getActiveTarget(args).id;
    const { pages } = await call(pagesUrl(siteId));
    if (!pages.length) return text("No pages yet. add_page creates one (with its HTML).");
    return text(`# Pages in site ${siteId}\n\n${pages.map(line).join("\n")}\n\nEdit a page's markup with read_site_file / edit_site_file on its file; its route and SEO with update_page.`);
  },

  async add(args) {
    const siteId = getActiveTarget(args).id;
    if (!args.name) throw new Error("Page name is required.");
    if (typeof args.text !== "string" || !args.text.trim()) {
      throw new Error(
        "On an HTML-first site add_page needs `text`: the page's HTML + Liquid. Read an existing page (read_site_file pages/index.liquid) and follow its structure ({% render 'header' %} … {% render 'footer' %})."
      );
    }
    const { page } = await call(pagesUrl(siteId), {
      method: "POST",
      body: { name: args.name, text: args.text, ...(args.seo ? { seo: args.seo } : {}), ...(args.pathPattern ? { pathPattern: args.pathPattern } : {}) },
    });
    if (args.isHomePage || args.is404Page) {
      await call(pagesUrl(siteId, page.pageId), { method: "PATCH", body: { isHomePage: !!args.isHomePage || undefined, is404Page: !!args.is404Page || undefined } });
    }
    getContext()._sourceFilesWritten = true;
    return text(`Page "${page.name}" created as ${page.pageId} at ${page.url}, file ${page.file}.\nEditor: ${getEditorUrl(siteId)}`);
  },

  async update(args) {
    const siteId = getActiveTarget(args).id;
    if (!args.pageId) throw new Error("pageId is required.");
    const fileOnly = Object.keys(FILE_FIELDS).filter(k => args[k] !== undefined);
    if (fileOnly.length) {
      throw new Error(`On an HTML-first site ${fileOnly.join(", ")} ${fileOnly.length > 1 ? "are" : "is"} markup: change ${fileOnly.map(k => FILE_FIELDS[k]).join("; ")} with edit_site_file. Nothing was changed.`);
    }
    const body = {};
    if (args.name !== undefined) Object.assign(body, { name: args.name, slug: args.name });
    for (const k of ["isHomePage", "is404Page", "isHidden", "seo"]) if (args[k] !== undefined) body[k] = args[k];
    if (args.pathPattern !== undefined) body.pathPattern = args.pathPattern || null;
    if (!Object.keys(body).length) throw new Error("Nothing to update: pass name, seo, pathPattern or a flag.");
    const { page } = await call(pagesUrl(siteId, args.pageId), { method: "PATCH", body });
    getContext()._sourceFilesWritten = true;
    return text(`Page ${page.pageId} updated: ${Object.keys(body).join(", ")}. It serves ${page.url}.`);
  },

  async remove(args) {
    const siteId = getActiveTarget(args).id;
    if (!args.pageId) throw new Error("pageId is required.");
    const { page } = await call(pagesUrl(siteId, args.pageId), { method: "DELETE" });
    getContext()._sourceFilesWritten = true;
    return text(`Page "${page.name}" (${page.pageId}) deleted with its file ${page.file || "(none)"}. Links to ${page.url} now 404: search_site_files for "${page.url}" to fix them.`);
  },
};
