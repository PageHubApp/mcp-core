/**
 * `list_pages` / `add_page` / `update_page` / `delete_page`: a page is a record (route, SEO, flags) plus its file,
 * served by `/api/v1/sites/:id/source-pages` (app repo: docs/features/html-first-ai-mcp.md).
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { parseMaybeJson } = require("../helpers/args");
const { getActiveTarget, getEditorUrl } = require("../helpers/target");

const text = t => ({ content: [{ type: "text", text: t }] });
const pagesUrl = (siteId, pageId) =>
  `/api/v1/sites/${encodeURIComponent(siteId)}/source-pages${pageId ? `/${encodeURIComponent(pageId)}` : ""}`;

/** Fields of update_page that are page markup, and what to do instead. */
const FILE_FIELDS = {
  headCode: "a tag in the page file's <head> (third-party code: site.json inject)",
  footerCode: "the end of the page file's <body>",
  bodyClass: "the class on the page file's <body> (the dashboard's per-page body class is update_page({ policy: { bodyClass } }))",
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

/** A page's access and look settings as one readable block. The password is never shown, only whether there is one. */
function policyLines(data) {
  const p = data.policy || {};
  const lines = [];
  lines.push(`  password: ${data.hasPassword ? "set" : "none"}`);
  if (Array.isArray(p.access) && p.access.length) {
    lines.push(`  access (groups are OR'd): ${JSON.stringify(p.access)}`);
    lines.push(`  on a deny: ${p.failAction === "redirect" ? `redirect to ${p.redirectUrl || "(no url)"}` : p.failAction === "show-page" ? `show ${p.fallbackPath || "(no path)"}` : "the default"}`);
  } else lines.push("  access conditions: none");
  if (p.bodyClass) lines.push(`  body class: ${p.bodyClass}`);
  if (Array.isArray(p.themeOverrides) && p.themeOverrides.length) lines.push(`  theme overrides: ${p.themeOverrides.map(o => `--${String(o.varName).replace(/^-+/, "")}: ${o.value}`).join("; ")}`);
  return lines.join("\n");
}

function line(p, i) {
  const flags = [p.isHomePage && "HOME", p.is404Page && "404", p.isHidden && "HIDDEN"].filter(Boolean);
  return `${i + 1}. **${p.pageId}** — "${p.name || "(unnamed)"}" (${p.url}, file ${p.file || "none"})${flags.length ? ` [${flags.join(", ")}]` : ""}`;
}

module.exports = {
  async list_pages(args) {
    const siteId = getActiveTarget(args).id;
    if (args.pageId) {
      const data = await call(pagesUrl(siteId, args.pageId));
      return text(`# ${data.page.name || data.page.pageId} (${data.page.pageId}, ${data.page.url})\n\nWho can open it and how it looks:\n${policyLines(data)}`);
    }
    const { pages } = await call(pagesUrl(siteId));
    if (!pages.length) return text("No pages yet. add_page creates one (with its HTML).");
    return text(`# Pages in site ${siteId}\n\n${pages.map(line).join("\n")}\n\nEdit a page's markup with read_site_file / edit_site_file on its file; its route and SEO with update_page.`);
  },

  async add_page(args) {
    const siteId = getActiveTarget(args).id;
    if (!args.name) throw new Error("Page name is required.");
    if (typeof args.text !== "string" || !args.text.trim()) {
      throw new Error(
        "add_page needs `text`: the page's HTML + Liquid. Read an existing page (read_site_file pages/index.liquid) and follow its structure ({% render 'header' %} … {% render 'footer' %})."
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

  async update_page(args) {
    const siteId = getActiveTarget(args).id;
    if (!args.pageId) throw new Error("pageId is required.");
    const fileOnly = Object.keys(FILE_FIELDS).filter(k => args[k] !== undefined);
    if (fileOnly.length) {
      throw new Error(`${fileOnly.join(", ")} ${fileOnly.length > 1 ? "are" : "is"} markup: change ${fileOnly.map(k => FILE_FIELDS[k]).join("; ")} with edit_site_file. Nothing was changed.`);
    }
    const body = {};
    if (args.name !== undefined) Object.assign(body, { name: args.name, slug: args.name });
    for (const k of ["isHomePage", "is404Page", "isHidden", "seo"]) if (args[k] !== undefined) body[k] = args[k];
    if (args.pathPattern !== undefined) body.pathPattern = args.pathPattern || null;
    if (args.policy !== undefined) {
      const policy = parseMaybeJson(args.policy);
      if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("policy must be an object: { password?, access?, failAction?, redirectUrl?, fallbackPath?, bodyClass?, themeOverrides? }.");
      body.policy = policy;
    }
    if (!Object.keys(body).length) throw new Error("Nothing to update: pass name, seo, pathPattern, policy or a flag.");
    const { page } = await call(pagesUrl(siteId, args.pageId), { method: "PATCH", body });
    getContext()._sourceFilesWritten = true;
    const head = `Page ${page.pageId} updated: ${Object.keys(body).join(", ")}. It serves ${page.url}.`;
    if (!body.policy) return text(head);
    // What is stored now (never the password), so the agent confirms what it set instead of assuming.
    const now = await call(pagesUrl(siteId, args.pageId));
    const note = "A password or access rule reaches visitors when the site is published; the draft preview isn't gated.";
    return text(`${head}\n\nNow:\n${policyLines(now)}\n${note}`);
  },

  async delete_page(args) {
    const siteId = getActiveTarget(args).id;
    if (!args.pageId) throw new Error("pageId is required.");
    const { page } = await call(pagesUrl(siteId, args.pageId), { method: "DELETE" });
    getContext()._sourceFilesWritten = true;
    return text(`Page "${page.name}" (${page.pageId}) deleted with its file ${page.file || "(none)"}. Links to ${page.url} now 404: search_site_files for "${page.url}" to fix them.`);
  },
};
