// Whitelist of valid args. Reject hallucinated keys (we've seen agents pass
// invented filters like `group: "acme-homepage-cards"` and then waste a tool
// call on the empty fallback). Better to fail fast with a "did you mean…"
// hint so the agent corrects on the next try.
const VALID_SEARCH_BLOCKS_KEYS = new Set([
  "q",
  "category",
  "categories",
  "subcategory",
  "tag",
  "preset",
  "source",
  "group",
  "style",
  "styles",
  "blockType",
  "featured",
  "sort",
  "page",
  "limit",
  // routing/internal opts the wrapper accepts but doesn't forward as filters
  "siteId",
  "templateSlug",
  "active",
]);

const { editDistance } = require("../../utils/levenshtein");

function nearestKey(invalid, valid) {
  const lower = String(invalid).toLowerCase();
  let best = null;
  let bestScore = Infinity;
  for (const v of valid) {
    const d = editDistance(lower, v.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = v;
    }
  }
  return bestScore <= Math.max(2, Math.floor(invalid.length / 3)) ? best : null;
}

module.exports = {
  VALID_SEARCH_BLOCKS_KEYS,
  nearestKey,
};
