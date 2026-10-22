/**
 * Which tools work on which kind of site. A site is either a Craft site (a node tree) or an HTML-first site (HTML +
 * Liquid files; `format: "html"` on `GET /api/v1/sites/:id` and in `list_sites`). Docs (app repo):
 * docs/features/html-first-ai-mcp.md.
 *
 * - Node-tree tools refuse an HTML-first site with `SITE_IS_HTML` (thrown by `fetchTarget`, and answered by the
 *   server's v1 site route as a backstop for any client).
 * - File tools refuse a Craft site (the files API answers `site_format_changed`).
 * - The block tools (search_blocks, get_block, list_blocks, apply_kit_block) and pull_template work on both: Liquid
 *   on an HTML-first site (handlers/library-format.js).
 * - Everything else (sites, publish, collections, media, Stripe, domains, screenshots, audits, pages) works on both.
 *
 * The in-app agent offers only the tools that fit the site it runs on (`toolFitsSiteFormat`), so it never spends a
 * step on a tool that would refuse.
 */

/** The node-tree tools, and the ones that edit a Craft block's node structure. */
const CRAFT_ONLY_TOOLS = new Set([
  "get_site_node",
  "list_site_nodes",
  "search_site_nodes",
  "patch_site_node",
  "patch_site_bulk",
  "add_nodes",
  "insert_node",
  "move_node",
  "delete_node",
  "place_section_tree",
  "pull_site",
  "get_component_schema",
  // search_blocks, get_block, list_blocks and apply_kit_block are NOT here: on an HTML-first site they read and place
  // Liquid (handlers/library-format.js). These edit a Craft block's node structure.
  "add_block",
  "add_custom_block",
  "list_block_nodes",
  "list_example_blocks",
  "extract_block",
  "save_as_block_template",
  "shuffle_block",
]);

/** The file tools. */
const HTML_ONLY_TOOLS = new Set([
  "list_site_files",
  "read_site_file",
  "write_site_file",
  "edit_site_file",
  "delete_site_file",
  "search_site_files",
  "list_components",
  "rename_component",
  "delete_component",
]);

const SITE_IS_HTML = "SITE_IS_HTML";

const SITE_IS_HTML_GUIDANCE =
  'This site is an HTML-first site: its pages are HTML + Liquid files, not a node tree. Use list_site_files, read_site_file, edit_site_file / write_site_file and search_site_files (the format: get_style_reference topic "liquid"). Pages: list_pages / add_page / update_page / delete_page. Blocks: search_blocks / get_block / apply_kit_block (Liquid); components: list_components. Theme: set_theme (or edit theme.css); favicon: set_favicon; company and lang: site.json.';

/** @param {"craft" | "html"} format */
function toolFitsSiteFormat(name, format) {
  return format === "html" ? !CRAFT_ONLY_TOOLS.has(name) : !HTML_ONLY_TOOLS.has(name);
}

/** The error a node-tree tool throws on an HTML-first site. */
function siteIsHtmlError(siteId) {
  const err = new Error(`[${SITE_IS_HTML}] Site ${siteId}: ${SITE_IS_HTML_GUIDANCE}`);
  err.code = SITE_IS_HTML;
  err.status = 409;
  return err;
}

/** True for `siteIsHtmlError` and for the server's 409 (`apiFetch` prefixes the code). */
function isSiteIsHtmlError(err) {
  return !!err && (err.code === SITE_IS_HTML || String(err.message || "").startsWith(`[${SITE_IS_HTML}]`));
}

module.exports = {
  CRAFT_ONLY_TOOLS,
  HTML_ONLY_TOOLS,
  SITE_IS_HTML,
  SITE_IS_HTML_GUIDANCE,
  toolFitsSiteFormat,
  siteIsHtmlError,
  isSiteIsHtmlError,
};
