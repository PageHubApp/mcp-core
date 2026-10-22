/**
 * The block library, templates and reusable components for HTML-first sites (app repo:
 * docs/features/html-first-templates-blocks-components.md, docs/features/html-first-ai-mcp.md "Blocks and templates").
 *
 * On an HTML-first site a block is a Liquid snippet and a component is a partial, so:
 *
 *   search_blocks / list_blocks / get_block   read the library as Liquid (`/api/v1/liquid-blocks`)
 *   apply_kit_block                           places a block into a page file (`POST /api/v1/sites/:id/blocks`)
 *   pull_template                             reads a template's files (`GET /api/v1/templates/:slug?format=liquid`)
 *   list_components / rename_component /      the site's partials and where they render
 *     delete_component                        (`/api/v1/sites/:id/components`)
 *
 * Not a tool module (its exports are not tools): `handlers/library-format.js` puts these in front of the node-tree
 * handlers, `handlers/html-components.js` wraps the component calls, `handlers/remote-templates.js` calls
 * `pullTemplateLiquid`.
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget, getEditorUrl } = require("./target");
const { resolveSiteFormat } = require("./site-format");
const { mergeStrList } = require("./args");

const text = t => ({ content: [{ type: "text", text: t }] });

/** The message a server refusal carries (`message`), else the thrown one. */
async function call(url, opts) {
  try {
    return await apiFetch(url, opts);
  } catch (err) {
    const b = err?.body || {};
    if (b.error === "lint") {
      const issues = (b.issues || []).slice(0, 8).map(i => `  - [${i.rule}] ${i.message}`).join("\n");
      throw new Error(`Nothing was saved: the result breaks the HTML-first rules.\n${issues}`);
    }
    if (b.message) throw new Error(b.message);
    throw err;
  }
}

/** Run the Liquid version on an HTML-first site, the node-tree handler otherwise. */
function wrapForSiteFormat(craft, html) {
  return async args => {
    const { html: isHtml } = await resolveSiteFormat(args || {});
    return isHtml ? html(args || {}) : craft(args);
  };
}

const blockLine = b => {
  const where = [b.category, b.subcategory].filter(Boolean).join("/");
  const styles = b.styles?.length ? ` (${b.styles.join(", ")})` : "";
  return `- **${b.slug}** — ${b.name} [${where}]${styles}${b.description ? `: ${b.description}` : ""}`;
};

async function fetchBlocks(args, limit) {
  const params = new URLSearchParams();
  if (args.q) params.set("q", String(args.q));
  const categories = mergeStrList(args.category, args.categories);
  const styles = mergeStrList(args.style, args.styles);
  // The server filters on one value; several narrow client-side below.
  if (categories.length === 1) params.set("category", categories[0]);
  if (styles.length === 1) params.set("style", styles[0]);
  params.set("limit", String(limit));
  const { blocks } = await call(`/api/v1/liquid-blocks?${params}`);
  return blocks.filter(
    b => (categories.length < 2 || categories.includes(b.category)) && (styles.length < 2 || (b.styles || []).some(s => styles.includes(s)))
  );
}

const APPLY_HINT = "apply_kit_block({ id, slug, pageId? }) places one into a page; read it first with get_block({ slug }).";

async function searchBlocksHtml(args) {
  const blocks = await fetchBlocks(args, Math.min(Number(args.limit) || 20, 100));
  if (!blocks.length) return text("No blocks match. Drop a filter, or list_blocks shows the whole library.");
  return text(`# Blocks (${blocks.length}) — Liquid snippets for an HTML-first site\n\n${blocks.map(blockLine).join("\n")}\n\n${APPLY_HINT}`);
}

async function listBlocksHtml(args) {
  const blocks = await fetchBlocks(args, 200);
  if (!blocks.length) return text("No block templates found.");
  const byCategory = {};
  for (const b of blocks) (byCategory[b.category || "uncategorized"] ||= []).push(b);
  const out = Object.entries(byCategory).map(([cat, list]) => `\n## ${cat}\n${list.map(blockLine).join("\n")}`);
  return text(`# Available blocks (Liquid)\n${out.join("\n")}\n\n${APPLY_HINT}`);
}

async function getBlockHtml(args) {
  if (!args.slug) throw new Error("slug is required.");
  const { block: b } = await call(`/api/v1/liquid-blocks/${encodeURIComponent(args.slug)}`);
  const notes = b.notes?.length ? `\n\n**Conversion notes:**\n${b.notes.map(n => `- ${n}`).join("\n")}` : "";
  return text(
    `# ${b.name} (\`${b.slug}\`)\n\n**Category:** ${b.category}${b.subcategory ? `/${b.subcategory}` : ""}${b.styles?.length ? `\n**Styles:** ${b.styles.join(", ")}` : ""}${b.description ? `\n**Description:** ${b.description}` : ""}${notes}\n\n## Liquid\n\n\`\`\`liquid\n${b.source}\n\`\`\`\n\nThis is a starting point, not a link: apply_kit_block copies it into a page (fresh ids), then edit_site_file rewrites the copy. To reuse one thing in many places, make it a partial and {% render %} it.`
  );
}

async function applyBlockHtml(args) {
  const siteId = getActiveTarget({ id: args.id }).id;
  if (!args.slug) throw new Error("slug is required: the block to place (search_blocks lists them).");
  if (args.sourceNodeId) {
    throw new Error("sourceNodeId clones a node-tree section and doesn't apply to an HTML-first site. Copy markup with read_site_file / edit_site_file, or place a block with slug.");
  }
  if (args.target === "header" || args.target === "footer") {
    throw new Error(`The ${args.target} is the partial partials/${args.target}.liquid on an HTML-first site: read it with read_site_file and rewrite it with edit_site_file. Nothing was placed.`);
  }
  if (args.contentOverrides || args.propOverrides) {
    throw new Error("contentOverrides / propOverrides are node-tree concepts. Place the block, then change its text with edit_site_file. Nothing was placed.");
  }
  const body = { slug: args.slug };
  if (args.pageId) body.pageId = args.pageId;
  if (args.before) body.before = args.before;
  else if (args.after) body.after = args.after;
  else if (args.position === 0) body.position = "start";
  const res = await call(`/api/v1/sites/${encodeURIComponent(siteId)}/blocks`, { method: "POST", body });
  getContext()._sourceFilesWritten = true;
  return text(`Placed block "${args.slug}" in ${res.path} (draft, file version ${String(res.version).slice(0, 12)}). Its markup is a copy: edit it with edit_site_file; screenshot_site shows it.\nEditor: ${getEditorUrl(siteId)}`);
}

/** The reply of `pull_template` for a template read as files (`GET /api/v1/templates/:slug?format=liquid`). */
async function pullTemplateLiquid(slug, path) {
  const data = await call(`/api/v1/templates/${encodeURIComponent(slug)}?format=liquid`);
  const files = data.files || [];
  if (path) {
    const f = files.find(x => x.path === path);
    if (!f) throw new Error(`Template "${slug}" has no file ${path}. Files: ${files.map(x => x.path).join(", ")}.`);
    return text(`# ${slug}: ${f.path}\n\n\`\`\`liquid\n${f.text}\n\`\`\``);
  }
  const total = files.reduce((n, f) => n + f.text.length, 0);
  const listing = files.map(f => `- ${f.path} (${f.text.length} chars)`).join("\n");
  const pages = (data.pages || []).map(p => `- ${p.displayName || p.pageSlug || "page"} → ${p.sourcePath}${p.isHomePage ? " (home)" : ""}`).join("\n");
  const head = `Template "${slug}" as HTML + Liquid (${files.length} files, ${data.from === "converted" ? "converted from its node tree" : "authored as HTML"}).\n\n## Pages\n${pages || "(none)"}\n\n## Files\n${listing}`;
  if (total > 60000) {
    return text(`${head}\n\nToo large to inline: pull_template({ slug: "${slug}", format: "liquid", path }) reads one file.`);
  }
  return text(`${head}\n\n${files.map(f => `## ${f.path}\n\n\`\`\`${f.path.endsWith(".css") ? "css" : f.path.endsWith(".json") ? "json" : "liquid"}\n${f.text}\n\`\`\``).join("\n\n")}`);
}

/** The HTML-first site a component tool works on; Craft sites have no partials. */
async function requireHtmlSite(args) {
  const siteId = getActiveTarget({ id: args.id }).id;
  const { html } = await resolveSiteFormat({ id: siteId });
  if (!html) throw new Error("Reusable components as partials exist on HTML-first sites. A node-tree site keeps its components in the dashboard.");
  return siteId;
}

const componentUrl = (siteId, name) => `/api/v1/sites/${encodeURIComponent(siteId)}/components${name ? `/${encodeURIComponent(name)}` : ""}`;

async function listComponentsHtml(args) {
  const siteId = await requireHtmlSite(args);
  const { components } = await call(componentUrl(siteId));
  if (!components.length) return text("No components yet. A component is a partial: partials/<name>.liquid, rendered with {% render '<name>' %}.");
  const lines = components.map(c => {
    const pages = c.usage.pages.map(p => p.name).join(", ");
    return `- **${c.id}** — ${c.name}: ${c.usage.instances} use${c.usage.instances === 1 ? "" : "s"}${pages ? ` (shown on ${pages})` : ""}`;
  });
  return text(`# Components in site ${siteId}\n\n${lines.join("\n")}\n\nEdit one with read_site_file / edit_site_file on partials/<id>.liquid: every page that renders it changes.`);
}

async function renameComponentHtml(args) {
  const siteId = await requireHtmlSite(args);
  if (!args.component || !args.name) throw new Error("component (its id from list_components) and name are required.");
  const { id } = await call(componentUrl(siteId, args.component), { method: "PATCH", body: { name: args.name } });
  getContext()._sourceFilesWritten = true;
  return text(`Component "${args.component}" is now "${id}": its file moved to partials/${id}.liquid and every {% render %} of it was rewritten.`);
}

async function deleteComponentHtml(args) {
  const siteId = await requireHtmlSite(args);
  if (!args.component) throw new Error("component (its id from list_components) is required.");
  const { id } = await call(componentUrl(siteId, args.component), { method: "DELETE" });
  getContext()._sourceFilesWritten = true;
  return text(`Component "${id}" deleted (partials/${id}.liquid).`);
}

module.exports = {
  wrapForSiteFormat,
  pullTemplateLiquid,
  searchBlocksHtml,
  listBlocksHtml,
  getBlockHtml,
  applyBlockHtml,
  listComponentsHtml,
  renameComponentHtml,
  deleteComponentHtml,
};

