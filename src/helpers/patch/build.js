/**
 * Assemble the "patch envelope" an MCP handler returns up to agent.ts for the
 * SSE tool_result event. Shape:
 *
 *   { nodes?: {id→node}, deletes?: [id...], rootChildren?: [id...] }
 *
 * Keeps handler return sites terse — they just hand us the flat map + which ids
 * they touched + the prior ROOT.nodes (so we can diff it).
 */

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * @param {Record<string, object>} flat          Full flat node map after mutation.
 * @param {Iterable<string>} touched             Ids that were added or modified.
 * @param {string[]|null} [prevRootChildren]     ROOT.nodes before mutation; omit to skip ROOT diff.
 * @param {string[]} [deletes]                   Explicit deletions (full subtrees).
 * @returns {{ nodes?: object, deletes?: string[], rootChildren?: string[] }}
 */
function buildPatch(flat, touched, prevRootChildren, deletes) {
  const out = {};
  const nodes = {};
  for (const id of touched) {
    if (flat && flat[id]) nodes[id] = flat[id];
  }
  if (Object.keys(nodes).length > 0) out.nodes = nodes;

  if (deletes && deletes.length > 0) out.deletes = deletes.slice();

  const newRoot = flat && flat.ROOT && flat.ROOT.nodes;
  if (Array.isArray(newRoot) && prevRootChildren !== undefined) {
    if (!arraysEqual(prevRootChildren, newRoot)) {
      out.rootChildren = newRoot.slice();
    }
  }

  return out;
}

module.exports = { buildPatch, arraysEqual };
