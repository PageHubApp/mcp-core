/**
 * Barrel export — real implementations live alongside this file in ./helpers/*.
 * Lives at `helpers/index.js` (not a sibling `helpers.js`) so Vercel NFT can't
 * tree-shake away the file via the directory-vs-file naming collision.
 */
const { parseMaybeJson, mergeStrList } = require("./args");
const { getActiveTarget, selectionNote, getActiveSiteId, getEditorUrl } = require("./target");

module.exports = {
  parseMaybeJson,
  mergeStrList,
  getActiveTarget,
  selectionNote,
  getActiveSiteId,
  getEditorUrl,
};
