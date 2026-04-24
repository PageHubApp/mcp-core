/**
 * Barrel export — real implementations live in ./helpers/*.
 * Do not add logic here; if you need a new helper, pick the right
 * file (args, node-patch, target, images, fill-mode) or make a new one.
 */
const { parseMaybeJson, mergeStrList } = require("./helpers/args");
const {
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
} = require("./helpers/node-patch");
const {
  decodeContentOrThrow,
  getActiveTarget,
  getActiveSiteId,
  isTemplateTarget,
  getEditorUrl,
  fetchTarget,
  fetchSite,
  saveTarget,
  saveSite,
} = require("./helpers/target");
const {
  extractImageUrls,
  validateImageUrls,
  collectAllImageUrls,
} = require("./helpers/images");
const {
  collectSubtreeNodeIds,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
} = require("./helpers/fill-mode");
const { mergeBlockModifiersIntoRoot } = require("./helpers/modifiers");
const { compressJsonToBase64Lz, decompressBase64LzToJson } = require("./lz");
const { guardRootCompanyPropsPatch } = require("./branding-guard");

module.exports = {
  parseMaybeJson,
  mergeStrList,
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  compressJsonToBase64Lz,
  decompressBase64LzToJson,
  decodeContentOrThrow,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
  getActiveTarget,
  getActiveSiteId,
  isTemplateTarget,
  getEditorUrl,
  fetchTarget,
  fetchSite,
  saveTarget,
  saveSite,
  extractImageUrls,
  validateImageUrls,
  collectAllImageUrls,
  collectSubtreeNodeIds,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
  guardRootCompanyPropsPatch,
  mergeBlockModifiersIntoRoot,
};
