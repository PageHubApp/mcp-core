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

module.exports = {
  VALID_COMPONENTS,
  CANVAS_COMPONENTS,
};
