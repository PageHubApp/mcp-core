/**
 * Patch-argument schema: allowed-key sets for each patch endpoint,
 * the valid target component types for typePatch, and the assertion
 * helpers that reject unknown fields with actionable hints.
 */

const { VALID_COMPONENTS, CANVAS_COMPONENTS } = require("../../core/component-registry");

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
    'Field "children" is not supported. Patch each child node by its kit_* id (e.g. Button nodes under a Container button group) using propsPatch for text, icon, and root styles — copy ids from the apply_kit_block reply.',
};

// Single source of truth lives in ../../node-utils. Re-exported under the
// patch-specific names so existing imports keep working.
const VALID_TYPE_PATCH_COMPONENTS = VALID_COMPONENTS;
const CANVAS_TYPE_PATCH_COMPONENTS = CANVAS_COMPONENTS;

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
      'typePatch must be a non-empty string (e.g. "Button") or object { resolvedName: "Button" }.'
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

// Real PageHub node IDs are slug-shaped: alphanumerics, _, -, .
// Anything with quotes / brackets / colons / commas / spaces is almost
// certainly the model serializing the entire tool args as one string and
// shoving them into the nodeId field (e.g. `"ROOT','propsPatch({"`).
// Catching that here gives a directly-actionable error instead of a confusing
// "Node <garbage> not found" downstream.
const MALFORMED_NODEID_CHARS = /["'(){}\[\]:,;=\s]/;
const VALID_NODEID_SHAPE = /^[A-Za-z0-9._-]+$/;

/**
 * Strip the most common qwen / small-model mis-serialization artifacts from a
 * nodeId: trailing quotes/commas, leading quotes, surrounding whitespace.
 * Returns the cleaned id if it ends up matching the valid slug shape, or null
 * if it's still garbage after cleaning.
 *
 * This recovers cases like `"ROOT',"` (model emitted a quote-comma instead of
 * closing the JSON string) without weakening the validator for truly bad input.
 */
function tryRecoverNodeId(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .replace(/^["']+/, "")
    .replace(/[,;'"\s]+$/, "")
    .trim();
  if (!cleaned) return null;
  return VALID_NODEID_SHAPE.test(cleaned) ? cleaned : null;
}

function assertNodeIdShape(nodeId, label, args) {
  if (nodeId == null) return nodeId; // upstream "Node ... not found" handles missing
  if (typeof nodeId !== "string") {
    throw new Error(
      `${label}: nodeId must be a string, got ${typeof nodeId}. Pass {nodeId, propsPatch, ...} as separate JSON fields.`
    );
  }
  if (MALFORMED_NODEID_CHARS.test(nodeId)) {
    // qwen3-coder regularly emits patch_site_node({nodeId:"ROOT',"}) — the
    // closing string quote got swallowed by a comma. If we can rescue the id
    // by stripping trailing junk, do so and mutate args in place so downstream
    // code sees the clean value. Otherwise fall through to the hard error.
    const recovered = tryRecoverNodeId(nodeId);
    if (recovered && args && typeof args === "object") {
      args.nodeId = recovered;
      return recovered;
    }
    const preview = nodeId.length > 60 ? `${nodeId.slice(0, 57)}...` : nodeId;
    throw new Error(
      `${label}: nodeId looks malformed (got "${preview}"). Likely your tool args were serialized as one string instead of separate JSON fields. Re-emit with {"nodeId": "<id>", "propsPatch": {...}} as distinct keys.`
    );
  }
  return nodeId;
}

function assertPatchSiteNodeArgs(args) {
  assertPatchKeys(args, PATCH_SITE_NODE_ARG_KEYS, "patch_site_node");
  if (args && typeof args === "object") assertNodeIdShape(args.nodeId, "patch_site_node", args);
}

function assertPatchBulkItem(item, index) {
  assertPatchKeys(item, PATCH_BULK_ITEM_KEYS, `patch_site_bulk patches[${index}]`);
  if (item && typeof item === "object")
    assertNodeIdShape(item.nodeId, `patch_site_bulk patches[${index}]`, item);
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
