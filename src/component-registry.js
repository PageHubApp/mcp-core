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
  "Accordion",
  "Audio",
  "Automatic",
  "Background",
  "Button",
  "ButtonList",
  "CartBadge",
  "CartDrawer",
  "CartItems",
  "CartSubtotal",
  "CheckoutBanner",
  "Container",
  "ContainerGroup",
  "Data",
  "Divider",
  "Dropdown",
  "Embed",
  "Footer",
  "Form",
  "FormElement",
  "Grid",
  "Header",
  "Icon",
  "Image",
  "ImageList",
  "Link",
  "List",
  "ListItem",
  "Map",
  "MapPoint",
  "Modal",
  "Nav",
  "ProductDisplay",
  "Spacer",
  "Table",
  "TableCell",
  "TableRow",
  "TableSection",
  "Tabs",
  "Text",
  "Video",
]);

const CANVAS_COMPONENTS = new Set([
  "Accordion",
  "Automatic",
  "Background",
  "CartDrawer",
  "CheckoutBanner",
  "Container",
  "ContainerGroup",
  "Data",
  "Dropdown",
  "Footer",
  "Form",
  "Grid",
  "Header",
  "List",
  "Modal",
  "Nav",
  "ProductDisplay",
  "Table",
  "TableRow",
  "TableSection",
  "Tabs",
]);

module.exports = {
  VALID_COMPONENTS,
  CANVAS_COMPONENTS,
};
