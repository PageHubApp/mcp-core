/**
 * Barrel export — real implementations live alongside this file in ./helpers/*.
 * Lives at `helpers/index.js` (not a sibling `helpers.js`) so Vercel NFT can't
 * tree-shake away the file via the directory-vs-file naming collision.
 */
const { parseMaybeJson, mergeStrList, assertInjectHtml } = require("./args");
const {
  applyNodePatches,
  normalizeNodePatchArgs,
  stripLockedStyling,
  normalizeBulkPatchesFromArgs,
  assertPatchSiteNodeArgs,
  assertPatchBulkItem,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
} = require("./node-patch");
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
} = require("./target");
const { extractImageUrls, validateImageUrls, collectAllImageUrls } = require("./images");
const {
  collectSubtreeNodeIds,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
} = require("./fill-mode");
const { mergeBlockModifiersIntoRoot } = require("./modifiers");
const { compressJsonToBase64Lz, decompressBase64LzToJson } = require("../codec/lz");
const { guardRootCompanyPropsPatch } = require("../validation/branding-guard");

module.exports = {
  parseMaybeJson,
  mergeStrList,
  assertInjectHtml,
  applyNodePatches,
  normalizeNodePatchArgs,
  stripLockedStyling,
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
