/**
 * Barrel export — real implementations live in ./patch/*.
 * patch/schema.js — allowed-key sets, type validators, assertions
 * patch/apply.js — the mutator + per-call arg normalization
 * patch/bulk-parse.js — model-JSON recovery heuristics for bulk input
 */
const {
  VALID_TYPE_PATCH_COMPONENTS,
  CANVAS_TYPE_PATCH_COMPONENTS,
  normalizeTypePatch,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
} = require("./patch/schema");
const { applyNodePatches, normalizeNodePatchArgs, stripLockedStyling } = require("./patch/apply");
const {
  parseBulkPatchesJsonString,
  splitTopLevelCommaSeparatedJsonValues,
  tryParseBulkPatchArrayElementsFromString,
  normalizeBulkPatchesFromArgs,
} = require("./patch/bulk-parse");

module.exports = {
  applyNodePatches,
  normalizeTypePatch,
  normalizeNodePatchArgs,
  stripLockedStyling,
  normalizeBulkPatchesFromArgs,
  parseBulkPatchesJsonString,
  splitTopLevelCommaSeparatedJsonValues,
  tryParseBulkPatchArrayElementsFromString,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
  VALID_TYPE_PATCH_COMPONENTS,
  CANVAS_TYPE_PATCH_COMPONENTS,
};
