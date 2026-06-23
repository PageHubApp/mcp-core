/**
 * Single source of truth for the MCP component allowlist + canvas allowlist.
 *
 * Re-exported under two name pairs that the rest of the codebase imports:
 *   - VALID_COMPONENTS / CANVAS_COMPONENTS  (node-utils.js — generic node validation)
 *   - VALID_TYPE_PATCH_COMPONENTS / CANVAS_TYPE_PATCH_COMPONENTS
 *     (helpers/patch/schema.js — typePatch in patch_site_node / patch_site_bulk)
 *
 * Keep this file as a leaf module (no internal imports) so it can be required
 * from anywhere without creating a circular dependency.
 *
 * When adding a new CraftJS component, update ONLY this file — every MCP
 * validator picks it up. See .claude/rules/sdk.md for the full registration
 * checklist.
 */

const VALID_COMPONENTS = new Set([
  "Audio",
  "Automatic",
  "Background",
  "Button",
  "CartBadge",
  "CartDrawer",
  "CartItems",
  "CartSubtotal",
  "CheckoutBanner",
  "Container",
  "Data",
  "Embed",
  "Footer",
  "Form",
  "FormElement",
  "Header",
  "Icon",
  "Image",
  "Link",
  "Map",
  "MapPoint",
  "ProductDisplay",
  "Text",
  "Video",
]);

const CANVAS_COMPONENTS = new Set([
  "Automatic",
  "Background",
  "CartDrawer",
  "CheckoutBanner",
  "Container",
  "Data",
  "Footer",
  "Form",
  "Header",
  "ProductDisplay",
]);

/**
 * Augment the allowlist with plugin-contributed component names at runtime
 * (P3 §4 — the MCP half of the component shim). mcp-core is a leaf module with
 * no SDK import, so the host app PUSHES the active plugin component names in
 * (each derived from a plugin's `defineComponent`) rather than mcp-core reading
 * the live resolver. Every validator (`node-utils`, `structure-ingest`,
 * `section-tree`, `helpers/patch/schema`) holds these exact Sets by reference,
 * so `.add` propagates to all of them. Idempotent — safe to call per request.
 *
 * @param {Array<{ name: string, canvas?: boolean }>} entries
 */
function registerPluginComponents(entries) {
  if (!Array.isArray(entries)) return;
  for (const e of entries) {
    if (!e || typeof e.name !== "string" || !e.name) continue;
    VALID_COMPONENTS.add(e.name);
    if (e.canvas) CANVAS_COMPONENTS.add(e.name);
  }
}

module.exports = {
  VALID_COMPONENTS,
  CANVAS_COMPONENTS,
  registerPluginComponents,
};
