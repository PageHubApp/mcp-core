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

/** True if arrays contain the same node ids with the same multiplicities (order ignored). */
function isSameChildIdMultiset(prev, next) {
  const a = Array.isArray(prev) ? prev.map(String) : [];
  const b = Array.isArray(next) ? next.map(String) : [];
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

/**
 * Remove specific Tailwind classes from a className string.
 * Supports exact matches and prefix matches (e.g. "gap-" removes "gap-4", "md:gap-8").
 */
function removeClasses(className, toRemove) {
  if (!className || !Array.isArray(toRemove) || toRemove.length === 0) return className;
  const parts = String(className).split(/\s+/).filter(Boolean);
  const filtered = parts.filter(cls => {
    // Strip responsive prefix for matching (e.g. "md:gap-4" → "gap-4")
    const bare = cls.replace(/^(sm:|md:|lg:|xl:|2xl:)/, "");
    for (const pattern of toRemove) {
      if (pattern === cls || pattern === bare) return false;
      // Prefix match: "gap-" removes "gap-4", "gap-8", etc.
      if (pattern.endsWith("-") && (bare.startsWith(pattern) || cls.startsWith(pattern)))
        return false;
    }
    return true;
  });
  return filtered.join(" ");
}

module.exports = {
  parseMaybeJson,
  mergeStrList,
  isSameChildIdMultiset,
  removeClasses,
};
