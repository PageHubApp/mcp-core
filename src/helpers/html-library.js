/**
 * The block library, templates and reusable components (app repo:
 * docs/features/html-first-templates-blocks-components.md, docs/features/html-first-ai-mcp.md "Blocks and templates").
 *
 * A block is a Liquid snippet and a component is a partial, so:
 *
 *   search_blocks / list_blocks / get_block   read the library as Liquid (`/api/v1/liquid-blocks`)
 *   apply_kit_block                           places a block into a page file (`POST /api/v1/sites/:id/blocks`)
 *   pull_template                             reads a template's files (`GET /api/v1/templates/:slug?format=liquid`)
 *   list_components / rename_component /      the site's partials and where they render
 *     delete_component                        (`/api/v1/sites/:id/components`)
 *
 * Not a tool module (its exports are not tools): `handlers/library-format.js` registers them as tools,
 * `handlers/remote-templates.js` calls `pullTemplateLiquid`.
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget, getEditorUrl } = require("./target");
const { mergeStrList } = require("./args");
const { applyEdits } = require("./file-edits");

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
  return text(
    `# ${b.name} (\`${b.slug}\`)\n\n**Category:** ${b.category}${b.subcategory ? `/${b.subcategory}` : ""}${b.styles?.length ? `\n**Styles:** ${b.styles.join(", ")}` : ""}${b.description ? `\n**Description:** ${b.description}` : ""}\n\n## Liquid\n\n\`\`\`liquid\n${b.source}\n\`\`\`\n\nThis is a starting point, not a link: apply_kit_block copies it into a page (fresh ids), then edit_site_file rewrites the copy. To reuse one thing in many places, make it a partial and {% render %} it.`
  );
}

async function applyBlockHtml(args) {
  const siteId = getActiveTarget({ id: args.id }).id;
  if (!args.slug) throw new Error("slug is required: the block to place (search_blocks lists them).");
  if (args.sourceNodeId) {
    throw new Error("sourceNodeId is not a thing here: sections are markup. Copy markup with read_site_file / edit_site_file, or place a block with slug.");
  }
  if (args.target === "header" || args.target === "footer") {
    throw new Error(`The ${args.target} is the partial partials/${args.target}.liquid on an HTML-first site: read it with read_site_file and rewrite it with edit_site_file. Nothing was placed.`);
  }
  if (args.contentOverrides || args.propOverrides) {
    throw new Error("contentOverrides / propOverrides do not exist: a block is Liquid text. Place the block, then change its text with edit_site_file. Nothing was placed.");
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
  const head = `Template "${slug}" as HTML + Liquid (${files.length} files).\n\n## Pages\n${pages || "(none)"}\n\n## Files\n${listing}`;
  if (total > 60000) {
    return text(`${head}\n\nToo large to inline: pull_template({ slug: "${slug}", format: "liquid", path }) reads one file.`);
  }
  return text(`${head}\n\n${files.map(f => `## ${f.path}\n\n\`\`\`${f.path.endsWith(".css") ? "css" : f.path.endsWith(".json") ? "json" : "liquid"}\n${f.text}\n\`\`\``).join("\n\n")}`);
}

/** The site a component tool works on. */
function requireSite(args) {
  return getActiveTarget({ id: args.id }).id;
}

const componentUrl = (siteId, name) => `/api/v1/sites/${encodeURIComponent(siteId)}/components${name ? `/${encodeURIComponent(name)}` : ""}`;

async function listComponentsHtml(args) {
  const siteId = requireSite(args);
  const { components } = await call(componentUrl(siteId));
  if (!components.length) return text("No components yet. A component is a partial: partials/<name>.liquid, rendered with {% render '<name>' %}.");
  const lines = components.map(c => {
    const pages = c.usage.pages.map(p => p.name).join(", ");
    return `- **${c.id}** — ${c.name}: ${c.usage.instances} use${c.usage.instances === 1 ? "" : "s"}${pages ? ` (shown on ${pages})` : ""}`;
  });
  return text(`# Components in site ${siteId}\n\n${lines.join("\n")}\n\nEdit one with read_site_file / edit_site_file on partials/<id>.liquid: every page that renders it changes.`);
}

async function renameComponentHtml(args) {
  const siteId = requireSite(args);
  if (!args.component || !args.name) throw new Error("component (its id from list_components) and name are required.");
  const { id } = await call(componentUrl(siteId, args.component), { method: "PATCH", body: { name: args.name } });
  getContext()._sourceFilesWritten = true;
  return text(`Component "${args.component}" is now "${id}": its file moved to partials/${id}.liquid and every {% render %} of it was rewritten.`);
}

async function deleteComponentHtml(args) {
  const siteId = requireSite(args);
  if (!args.component) throw new Error("component (its id from list_components) is required.");
  const { id } = await call(componentUrl(siteId, args.component), { method: "DELETE" });
  getContext()._sourceFilesWritten = true;
  return text(`Component "${id}" deleted (partials/${id}.liquid).`);
}

const BLOCK_FIELDS = ["name", "description", "visual", "category", "subcategory", "tags", "preset", "group", "isPublic", "isFeatured", "isCategoryPreview"];

/** Create a library block from Liquid `source` (admin or tenant). */
async function saveBlock(args) {
  if (!args.name || !args.slug || !args.category || !args.source) throw new Error("name, slug, category and source (the block's Liquid) are required.");
  const body = { source: args.source };
  for (const f of BLOCK_FIELDS) if (args[f] !== undefined) body[f] = args[f];
  body.slug = args.slug;
  if (args.style) body.style = args.style;
  const { component: c } = await call("/api/v1/components", { method: "POST", body });
  return text(`Block saved: **${c.name}** (\`${c.slug}\`)\nPublic: ${c.isPublic}\nCategory: ${c.category}`);
}

/** Change a library block's metadata, or replace its Liquid `source` (read it with get_block, edit, send it back). */
async function updateBlock(args) {
  if (!args.slug) throw new Error("slug is required.");
  const existing = await call(`/api/v1/components/${encodeURIComponent(args.slug)}`);
  const expectedVersion = Number((existing.component || existing)?.version || 1);
  const body = {};
  for (const f of BLOCK_FIELDS) if (args[f] !== undefined) body[f] = args[f];
  if (args.source !== undefined) body.source = args.source;
  if (args.style !== undefined) body.style = args.style;
  if (args.newSlug !== undefined) body.slug = args.newSlug;
  if (!Object.keys(body).length) throw new Error("Nothing to update. Provide at least one field.");
  const { component: c } = await call(`/api/v1/components/${encodeURIComponent(args.slug)}`, { method: "PUT", body: { ...body, expectedVersion } });
  return text(`Block updated: **${c.name}** (\`${c.slug}\`)\nCategory: ${c.category}\nPublic: ${c.isPublic}`);
}

/**
 * Exact-text edits to a library block's Liquid `source` (like edit_site_file), saved as one update. `edits[]` covers
 * the bulk case; the block's version guards against a concurrent change.
 */
async function patchBlock(args) {
  if (!args.slug) throw new Error("slug is required.");
  const edits = Array.isArray(args.edits) ? args.edits : [];
  if (!edits.length) throw new Error("edits is required: [{ oldText, newText }].");
  const { block } = await call(`/api/v1/liquid-blocks/${encodeURIComponent(args.slug)}`);
  const existing = await call(`/api/v1/components/${encodeURIComponent(args.slug)}`);
  const expectedVersion = Number((existing.component || existing)?.version || 1);
  const next = applyEdits(String(block.source), edits, `block ${args.slug}`);
  if (next === block.source) return text(`No change: block "${args.slug}" already reads that way.`);
  await call(`/api/v1/components/${encodeURIComponent(args.slug)}`, { method: "PUT", body: { source: next, expectedVersion } });
  return text(`Block "${args.slug}" edited (${edits.length} change${edits.length > 1 ? "s" : ""}).`);
}

/** Delete a library block by slug (admin). */
async function deleteBlock(args) {
  if (!args.slug) throw new Error("slug is required.");
  await call(`/api/v1/components/${encodeURIComponent(args.slug)}`, { method: "DELETE" });
  return text(`Block "${args.slug}" deleted.`);
}

module.exports = {
  patchBlock,
  saveBlock,
  updateBlock,
  deleteBlock,
  pullTemplateLiquid,
  searchBlocksHtml,
  listBlocksHtml,
  getBlockHtml,
  applyBlockHtml,
  listComponentsHtml,
  renameComponentHtml,
  deleteComponentHtml,
};

