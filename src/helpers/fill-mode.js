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
    throw new Error(
      `Parallel fill: cannot edit node "${nodeId}" — only nodes inside your section "${label}" are editable. Do not patch other sections.`
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
  throw new Error(
    `Parallel fill: patch_site_bulk lists node(s) outside your section "${secLabel}": ${uniq.join(", ")}. ` +
      `Remove those entries — only kit_* ids from your apply_kit_block reply under "${secLabel}". Never include sibling sec_* containers (e.g. sec_hero fill must not patch sec_features).`
  );
}

module.exports = {
  collectSubtreeNodeIds,
  getFillModePatchSubtreeRootId,
  assertFillModePatchAllowed,
  assertFillModeBulkPatchesAllowed,
};
