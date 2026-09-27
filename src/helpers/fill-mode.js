/** All node ids in the subtree rooted at rootId (includes rootId). */
function collectSubtreeNodeIds(flat, rootId) {
  const ids = new Set();
  const walk = id => {
    if (!id || !flat[id] || ids.has(id)) return;
    ids.add(id);
    for (const c of flat[id].nodes || []) walk(c);
  };
  walk(rootId);
  return ids;
}

/**
 * Footer parallel fills use sectionNodeId "sec_footer" for bookkeeping, but apply_kit_block(target:"footer")
 * installs kit nodes under ftr_root — patch allowlist must follow that subtree.
 */
function getFillModePatchSubtreeRootId(flat, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId) return null;
  if (ctx.footerFill && flat?.ftr_root) return "ftr_root";
  return String(ctx.sectionNodeId);
}

/** Parallel section fills may only patch nodes inside the assigned section canvas. */
function assertFillModePatchAllowed(flat, nodeId, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId) return;
  const rootId = getFillModePatchSubtreeRootId(flat, ctx);
  if (!rootId || !flat[rootId]) return;
  const allowed = collectSubtreeNodeIds(flat, rootId);
  if (!allowed.has(nodeId)) {
    const label = ctx.footerFill && rootId === "ftr_root" ? "footer (ftr_root)" : rootId;
    const profile = ctx?.fillProfile === "components" ? "components" : "blocks";
    const tail =
      profile === "components"
        ? ` This id doesn't exist yet — build the whole section with ONE place_section_tree call, then patch the ids it returns.`
        : ` Only nodes inside your section "${label}" are editable.`;
    throw new Error(
      `Parallel fill: cannot edit node "${nodeId}" — not inside your section "${label}".${tail}`
    );
  }
}

/**
 * Fill mode: validate every patch target before applying any (avoids partial applies + clearer errors when one bulk mixes sec_*).
 */
function assertFillModeBulkPatchesAllowed(flat, patchList, ctx) {
  if (!ctx?.fillMode || !ctx.sectionNodeId || !Array.isArray(patchList)) return;
  const rootId = getFillModePatchSubtreeRootId(flat, ctx);
  if (!rootId || !flat[rootId]) return;
  const allowed = collectSubtreeNodeIds(flat, rootId);
  const bad = [];
  for (const item of patchList) {
    const nid = item?.nodeId;
    if (typeof nid !== "string") continue;
    if (!allowed.has(nid)) bad.push(nid);
  }
  if (bad.length === 0) return;
  const uniq = [...new Set(bad)];
  const secLabel = ctx.footerFill && rootId === "ftr_root" ? "footer (ftr_root)" : rootId;
  const profile = ctx?.fillProfile === "components" ? "components" : "blocks";
  const hint =
    profile === "components"
      ? `These node ids don't exist in your section yet. In components mode, build the section with ONE place_section_tree call (complete nested hierarchy, root Container) — patch_site_bulk is for refinements AFTER place_section_tree succeeds, using the ids it returned. Re-issue these nodes inside place_section_tree.hierarchy.children.`
      : `Remove those entries — only kit_* ids from your apply_kit_block reply under "${secLabel}". Never include sibling sec_* containers (e.g. sec_hero fill must not patch sec_features).`;
  throw new Error(
    `Parallel fill: patch_site_bulk lists node(s) outside your section "${secLabel}": ${uniq.join(", ")}. ` +
      hint
  );
}

module.exports = {
  collectSubtreeNodeIds,
  getFillModePatchSubtreeRootId,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
};
