/**
 * Patch-argument schema: allowed-key sets for each patch endpoint,
 * the valid target component types for typePatch, and the assertion
 * helpers that reject unknown fields with actionable hints.
 */

const PATCH_BODY_KEYS = [
  "typePatch",
  "propsPatch",
  "classNamePatch",
  "nodesPatch",
  "unsetProps",
  "unsetClasses",
];

/** Allowed top-level keys for patch_site_node. */
const PATCH_SITE_NODE_ARG_KEYS = new Set([
  "id",
  "slug",
  "nodeId",
  ...PATCH_BODY_KEYS,
  "name",
  "title",
  "description",
]);

/** Allowed keys for patch_block (block library slug + same patch fields as site nodes). */
const PATCH_BLOCK_NODE_ARG_KEYS = new Set(["slug", "nodeId", ...PATCH_BODY_KEYS]);

/** Allowed keys on each patch_site_bulk array element (no nested "patches"). */
const PATCH_BULK_ITEM_KEYS = new Set([
  "nodeId",
  ...PATCH_BODY_KEYS,
  "name",
  "title",
  "description",
  "id",
]);

/** Allowed keys on each patch_block_bulk array element. */
const PATCH_BLOCK_BULK_ITEM_KEYS = new Set(["nodeId", ...PATCH_BODY_KEYS]);

const UNSUPPORTED_PATCH_FIELD_HINTS = {
  children:
    'Field "children" is not supported. Patch each child node by its kit_* id (e.g. Button nodes under ButtonList) using propsPatch for text, icon, and root styles — copy ids from the apply_kit_block reply.',
};

const VALID_TYPE_PATCH_COMPONENTS = new Set([
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
  "Spacer",
  "Table",
  "TableCell",
  "TableRow",
  "TableSection",
  "Tabs",
  "Text",
  "Video",
]);

const CANVAS_TYPE_PATCH_COMPONENTS = new Set([
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
  "Table",
  "TableRow",
  "TableSection",
  "Tabs",
]);

function normalizeTypePatch(rawTypePatch) {
  if (rawTypePatch == null) return null;
  const typeName =
    typeof rawTypePatch === "string"
      ? rawTypePatch.trim()
      : typeof rawTypePatch === "object" && typeof rawTypePatch.resolvedName === "string"
        ? rawTypePatch.resolvedName.trim()
        : "";
  if (!typeName) {
    throw new Error(
      "typePatch must be a non-empty string (e.g. \"Button\") or object { resolvedName: \"Button\" }."
    );
  }
  if (!VALID_TYPE_PATCH_COMPONENTS.has(typeName)) {
    throw new Error(
      `typePatch "${typeName}" is not a supported component type. Allowed: ${[
        ...VALID_TYPE_PATCH_COMPONENTS,
      ].join(", ")}.`
    );
  }
  return typeName;
}

function assertPatchKeys(obj, allowedSet, label) {
  if (!obj || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    if (allowedSet.has(k)) continue;
    const hint =
      UNSUPPORTED_PATCH_FIELD_HINTS[k] ||
      `Unknown field "${k}". Allowed: ${[...allowedSet].sort().join(", ")}.`;
    throw new Error(`${label}: ${hint}`);
  }
}

function assertPatchSiteNodeArgs(args) {
  assertPatchKeys(args, PATCH_SITE_NODE_ARG_KEYS, "patch_site_node");
}

function assertPatchBulkItem(item, index) {
  assertPatchKeys(item, PATCH_BULK_ITEM_KEYS, `patch_site_bulk patches[${index}]`);
}

function assertPatchBlockNodeArgs(args) {
  assertPatchKeys(args, PATCH_BLOCK_NODE_ARG_KEYS, "patch_block");
}

function assertPatchBlockBulkItem(item, index) {
  assertPatchKeys(item, PATCH_BLOCK_BULK_ITEM_KEYS, `patch_block_bulk patches[${index}]`);
}

module.exports = {
  PATCH_BODY_KEYS,
  PATCH_SITE_NODE_ARG_KEYS,
  PATCH_BLOCK_NODE_ARG_KEYS,
  PATCH_BULK_ITEM_KEYS,
  PATCH_BLOCK_BULK_ITEM_KEYS,
  UNSUPPORTED_PATCH_FIELD_HINTS,
  VALID_TYPE_PATCH_COMPONENTS,
  CANVAS_TYPE_PATCH_COMPONENTS,
  normalizeTypePatch,
  assertPatchKeys,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
};
