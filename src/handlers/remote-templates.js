/**
 * Template tools — list / pull / save / update / publish-site-as-template / delete. Wraps `/api/v1/templates/*`.
 * A template is a bundle of HTML + Liquid files and page rows (`SiteTemplate.html`). Every template tool takes the
 * template `slug` explicitly (there is no "active template"). Saving, updating and deleting need admin or a tenant
 * owner / editor.
 */

const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/target");
const { applyEdits } = require("../helpers/file-edits");
const { pullTemplateLiquid } = require("../helpers/html-library");

const text = t => ({ content: [{ type: "text", text: t }] });

/** The server's refusal as a sentence (`message`), else the thrown error. */
async function call(url, opts) {
  try {
    return await apiFetch(url, opts);
  } catch (err) {
    const b = err?.body || {};
    if (b.message) throw new Error(b.message);
    throw err;
  }
}

const META = ["title", "tagline", "description", "category", "tags", "hidden", "isPublic", "sortOrder"];
const pick = (args, keys) => Object.fromEntries(keys.filter(k => args[k] !== undefined).map(k => [k, args[k]]));

module.exports = {
  /**
   * Browse the template catalog with optional filters.
   * @param {object} args - { category?, tag?, q? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async list_templates(args = {}) {
    const params = new URLSearchParams();
    if (args.category) params.set("category", args.category);
    if (args.tag) params.set("tag", args.tag);
    if (args.q) params.set("q", args.q);
    const qs = params.toString();
    const data = await apiFetch(`/api/v1/templates${qs ? `?${qs}` : ""}`);
    const lines = (data.templates || []).map(t => {
      let line = `• ${t.slug} — ${t.title}`;
      if (t.category) line += ` [${t.category}]`;
      if (t.tags?.length) line += ` (${t.tags.join(", ")})`;
      if (t.hidden) line += " (hidden)";
      return line;
    });
    return {
      content: [{ type: "text", text: lines.length ? lines.join("\n") : "No templates found." }],
    };
  },

  /**
   * Read a stock template's HTML + Liquid files by slug (all of them, or one `path`).
   * @param {object} args - { slug, path? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async pull_template(args) {
    if (!args.slug) throw new Error("slug is required.");
    return pullTemplateLiquid(args.slug, args.path);
  },

  /**
   * Create a template from `files` (+ `pages`), or from an HTML-first site's draft (`fromSite`).
   * @param {object} args - { slug, title, files?, pages?, fromSite?, tagline?, description?, category?, tags?, hidden?, isPublic?, sortOrder? }
   */
  async save_template(args = {}) {
    if (!args.slug || !args.title) throw new Error("slug and title are required.");
    if (!args.files && !args.fromSite) throw new Error("files (or fromSite: a site id) is required: a template is its files.");
    const body = { slug: args.slug, ...pick(args, META), ...pick(args, ["files", "pages", "fromSite"]) };
    const data = await call("/api/v1/templates", { method: "POST", body });
    return text(`Template saved: **${data.title}** (\`${data.slug}\`). Read it back with pull_template({ slug: "${data.slug}" }).`);
  },

  /**
   * Snapshot the active site's draft files and pages into a new template.
   * @param {object} args - { id?, slug?, title?, description?, category?, tags?, hidden?, isPublic?, sortOrder? }
   */
  async publish_site_as_template(args = {}) {
    const siteId = getActiveTarget({ id: args.id }).id;
    const site = await call(`/api/v1/sites/${encodeURIComponent(siteId)}`);
    const slug = args.slug || site.name || siteId;
    const title = args.title || site.title || site.name || slug;
    const data = await call("/api/v1/templates", {
      method: "POST",
      body: { slug, title, fromSite: siteId, ...pick(args, META.filter(k => k !== "title")) },
    });
    return text(`Site published as template: **${data.title}** (\`${data.slug}\`)`);
  },

  /**
   * Change a template: metadata, whole files (`files`, merged over the current ones; `{ path, delete: true }` removes
   * one), exact-text `edits` per file, page rows (`pages`), or everything from a site (`fromSite`).
   * @param {object} args - { slug, title?, ..., files?, edits?: [{ path, edits: [{ oldText, newText }] }], pages?, fromSite?, replace? }
   */
  async update_template(args = {}) {
    if (!args.slug) throw new Error("slug is required.");
    const current = await call(`/api/v1/templates/${encodeURIComponent(args.slug)}`);
    const expectedVersion = Number(current?.version || 1);
    const body = { ...pick(args, META), ...pick(args, ["files", "pages", "fromSite", "replace"]) };
    if (Array.isArray(args.edits) && args.edits.length) {
      const pulled = await call(`/api/v1/templates/${encodeURIComponent(args.slug)}?format=liquid`);
      const byPath = new Map(pulled.files.map(f => [f.path, f.text]));
      const files = [...(Array.isArray(body.files) ? body.files : [])];
      for (const e of args.edits) {
        if (!e?.path || !byPath.has(e.path)) throw new Error(`Template "${args.slug}" has no file ${e?.path}. pull_template lists them.`);
        files.push({ path: e.path, text: applyEdits(byPath.get(e.path), e.edits || [], e.path) });
      }
      body.files = files;
    }
    if (!Object.keys(body).length) throw new Error("Nothing to update. Provide at least one field.");
    const data = await call(`/api/v1/templates/${encodeURIComponent(args.slug)}`, { method: "PUT", body: { ...body, expectedVersion } });
    return text(`Template updated: **${data.title}** (\`${data.slug}\`)`);
  },

  /**
   * Delete a template by slug.
   * @param {object} args - { slug }
   */
  async delete_template(args = {}) {
    if (!args.slug) throw new Error("slug is required.");
    await call(`/api/v1/templates/${encodeURIComponent(args.slug)}`, { method: "DELETE" });
    return text(`Template "${args.slug}" deleted.`);
  },
};
