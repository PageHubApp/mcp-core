/** Try to JSON.parse a string, return as-is if it fails or isn't a string. */
function parseMaybeJson(v) {
  if (v == null) return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      // Attempt lightweight repairs for common model JSON mistakes:
      // 1. Swapped ]} → }] (model closes array before object)
      // 2. Trailing commas before } or ]
      const repaired = v
        .replace(/"\s*\]\s*\}/g, (m, offset) => {
          // Check if there's an unclosed { — the ] and } may be swapped
          const lastOpen = v.lastIndexOf("{", offset);
          const lastClose = v.lastIndexOf("}", offset);
          if (lastOpen > lastClose) {
            return '"}]';
          }
          return m;
        })
        .replace(/,\s*([}\]])/g, "$1");
      if (repaired !== v) {
        try {
          return JSON.parse(repaired);
        } catch {
          /* fall through */
        }
      }
      return v;
    }
  }
  return v;
}

/**
 * Merge singular + list MCP args into deduped trimmed strings (comma-split on strings).
 * @param {string|string[]|undefined|null} singular e.g. args.category
 * @param {string|string[]|undefined|null} listish e.g. args.categories
 * @returns {string[]}
 */
function mergeStrList(singular, listish) {
  const parts = [];
  const add = v => {
    if (v == null || v === "") return;
    if (Array.isArray(v)) {
      for (const x of v) add(x);
      return;
    }
    for (const piece of String(v).split(",")) {
      const t = piece.trim();
      if (t) parts.push(t);
    }
  };
  add(singular);
  add(listish);
  return [...new Set(parts)];
}

module.exports = {
  parseMaybeJson,
  mergeStrList,
};
