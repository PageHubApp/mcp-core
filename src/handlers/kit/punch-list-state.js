/**
 * Per-request punch-list state shared between kit.js (stashes pending entries
 * on `apply_kit_block`) and remote-nodes.js (prunes entries as patches arrive,
 * surfaces missed ones in the response tail).
 *
 * Not an MCP handler — lives in its own file so it doesn't get pulled into the
 * handler dispatch map when other handler modules are spread-merged in index.js.
 */

function stashPendingPunchList(ctx, items) {
  if (!ctx || !Array.isArray(items) || items.length === 0) return;
  if (!ctx._pendingPunchList) ctx._pendingPunchList = new Map();
  for (const item of items) {
    if (!item?.nodeId) continue;
    ctx._pendingPunchList.set(item.nodeId, item);
  }
}

function consumePunchListAndFormatMissed(ctx, touchedIds) {
  if (!ctx?._pendingPunchList || ctx._pendingPunchList.size === 0) return "";
  for (const id of touchedIds || []) {
    ctx._pendingPunchList.delete(String(id));
  }
  if (ctx._pendingPunchList.size === 0) return "";
  const TYPE_ORDER = { Link: 0, Button: 1, Text: 2, Image: 3 };
  const rows = [...ctx._pendingPunchList.values()]
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9))
    .slice(0, 30)
    .map(i => {
      const cur =
        i.current && i.current.length > 80 ? `${i.current.slice(0, 77)}…` : i.current || "(empty)";
      return `  - ${i.nodeId} (${i.type} "${i.label}"): "${cur}"`;
    });
  return (
    `\n\nSTILL MISSED from earlier punch list (${ctx._pendingPunchList.size} item(s) — patch in next call):\n` +
    rows.join("\n") +
    `\n\nThese were flagged when the kit was applied and have NOT been patched yet. Send another patch_site_bulk for them now — do not move on to the next section while these still ship as kit defaults.`
  );
}

module.exports = { stashPendingPunchList, consumePunchListAndFormatMissed };
