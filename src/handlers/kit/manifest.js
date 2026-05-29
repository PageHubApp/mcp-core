/**
 * Internal: format the "kit node id manifest" that `apply_kit_block`
 * returns to the agent. Surfaces a label → id JSON map so models stop
 * inventing ids like `kit_<slug>_heading` and copy real ids instead.
 */

function formatKitNodeIdManifest(newNodes, rootId, sectionContainerId, maxLines = 80) {
  const ids = Object.keys(newNodes).sort();
  const head = ids.slice(0, maxLines);

  // Label → id map. Models tend to invent ids like `kit_cta_simple_heading`
  // by pattern-matching labels; giving them a copy-pasteable JSON map removes
  // any need to guess. Keys are the exact labels; values are the real ids.
  const labelMap = {};
  for (const id of head) {
    const n = newNodes[id];
    const label = n?.custom?.displayName || n?.type?.resolvedName || id;
    if (labelMap[label]) {
      // duplicate labels (e.g. repeated "Title") — keep array of ids
      if (!Array.isArray(labelMap[label])) labelMap[label] = [labelMap[label]];
      labelMap[label].push(id);
    } else {
      labelMap[label] = id;
    }
  }
  const tail =
    ids.length > maxLines ? `\n  …and ${ids.length - maxLines} more (same \`kit_…\` prefix)` : "";
  return (
    `Section container: \`${sectionContainerId}\`\n` +
    `Kit root id: \`${rootId}\`\n` +
    `LABEL→ID MAP (copy ids EXACTLY from the right-hand side — do NOT invent semantic ids like \`kit_<slug>_heading\`; those do not exist):\n` +
    "```json\n" +
    JSON.stringify(labelMap, null, 2) +
    "\n```" +
    tail
  );
}

module.exports = { formatKitNodeIdManifest };
