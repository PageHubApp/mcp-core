const { getContext } = require("../../core/context");

/** Scan _pendingFlatMap for block slugs via custom.source metadata and kit_* node ID prefixes. */
function detectUsedBlockSlugs() {
  try {
    const ctx = getContext();
    const flat = ctx?._pendingFlatMap;
    if (!flat || typeof flat !== "object") return [];
    const slugSet = new Set();
    for (const [key, node] of Object.entries(flat)) {
      // Prefer explicit source metadata (stamped by apply_kit_block)
      const src = node?.custom?.source;
      if (src?.type === "block" && src.block) {
        slugSet.add(src.block);
        continue;
      }
      // Fallback: kit node IDs follow pattern: kit_<slug_with_underscores>_<hash>_n<N>
      const match = key.match(/^kit_(.+?)_[a-f0-9]{8}_n\d+$/);
      if (match) {
        slugSet.add(match[1].replace(/_/g, "-"));
      }
    }
    return [...slugSet];
  } catch {
    return [];
  }
}

/**
 * Walk a flat node map and surface page sections that are rich enough to adapt
 * (≥5 descendants, ≥2 distinct child component types). Skips the section the
 * current fill worker is filling — adapting itself is a no-op.
 *
 * Result is consumed by search_blocks to suggest `apply_kit_block({ sourceNodeId })`
 * as an alternative to stamping a fresh library block.
 */
function detectAdaptableSections(flat, currentSection) {
  try {
    if (!flat || typeof flat !== "object") return [];

    const candidates = [];
    for (const [id, node] of Object.entries(flat)) {
      if (!node || typeof node !== "object") continue;
      if (node.props?.type !== "section") continue;
      if (id === "hdr_root" || id === "ftr_root") continue;
      if (currentSection && id === currentSection) continue;
      const parent = node.parent ? flat[node.parent] : null;
      if (!parent || parent.props?.type !== "page") continue;

      let descendantCount = 0;
      const childTypes = new Set();
      const stack = [...(node.nodes || [])];
      while (stack.length) {
        const child = flat[stack.pop()];
        if (!child) continue;
        descendantCount++;
        const t = child.type?.resolvedName;
        if (t) childTypes.add(t);
        if (Array.isArray(child.nodes)) stack.push(...child.nodes);
      }
      if (descendantCount < 5 || childTypes.size < 2) continue;

      candidates.push({
        nodeId: id,
        displayName: node.custom?.displayName || "Section",
        blockSlug: node.custom?.source?.type === "block" ? node.custom.source.block : null,
        descendantCount,
        childTypes: [...childTypes].sort(),
      });
    }
    candidates.sort((a, b) => b.descendantCount - a.descendantCount);
    return candidates.slice(0, 8);
  } catch {
    return [];
  }
}

module.exports = {
  detectUsedBlockSlugs,
  detectAdaptableSections,
};
