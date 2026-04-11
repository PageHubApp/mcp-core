/**
 * Same merge rules as utils/designIntentMerge.ts (CJS for mcp-core handlers).
 * @param {Record<string, any>} flat
 * @param {string | null | undefined} leafId
 */
function getAncestorChainIds(flat, leafId) {
  if (!flat || !flat.ROOT) return [];
  if (!leafId || leafId === "ROOT") return ["ROOT"];
  if (!flat[leafId]) return ["ROOT"];

  const up = [];
  let cur = leafId;
  const guard = new Set();
  while (cur && !guard.has(cur)) {
    if (!flat[cur]) break;
    guard.add(cur);
    up.push(cur);
    const p = flat[cur]?.parent;
    cur = typeof p === "string" && p ? p : undefined;
  }
  if (up.length === 0 || up[up.length - 1] !== "ROOT") {
    return ["ROOT"];
  }
  return up.reverse();
}

const DESIGN_NOTES_MAX = 1200;
const DESIGN_TAG_MAX_LEN = 50;
const DESIGN_TAGS_MAX_COUNT = 24;

function truncateDesignNotesLocal(s) {
  const t = String(s).trim();
  if (t.length <= DESIGN_NOTES_MAX) return t;
  return `${t.slice(0, DESIGN_NOTES_MAX - 1)}…`;
}

function normalizeDesignTagsLocal(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const x = t.trim().slice(0, DESIGN_TAG_MAX_LEN);
    if (x && !out.includes(x)) out.push(x);
    if (out.length >= DESIGN_TAGS_MAX_COUNT) break;
  }
  return out;
}

function nodeIntentLabel(flat, id) {
  if (id === "ROOT") return "Page";
  const n = flat[id];
  if (!n) return id;
  const dn = typeof n.displayName === "string" && n.displayName.trim() ? n.displayName.trim() : "";
  if (dn) return dn;
  const rn = n.type?.resolvedName;
  if (typeof rn === "string" && rn.trim()) return rn.trim();
  const nm = typeof n.name === "string" && n.name.trim() ? n.name.trim() : "";
  if (nm) return nm;
  return id;
}

function mergeDesignIntentFromChain(flat, leafId) {
  if (!flat?.ROOT) return { designNotes: "", designTags: [] };
  const chain = getAncestorChainIds(flat, leafId);
  const noteParts = [];
  const tagOrdered = [];
  const seenTags = new Set();

  for (const id of chain) {
    const n = flat[id];
    const props = n?.props;
    const raw = props?.designNotes;
    if (typeof raw === "string" && raw.trim()) {
      noteParts.push(`[${nodeIntentLabel(flat, id)}] ${raw.trim()}`);
    }
    const rawTags = normalizeDesignTagsLocal(props?.designTags);
    for (const t of rawTags) {
      if (seenTags.has(t)) continue;
      seenTags.add(t);
      tagOrdered.push(t);
    }
  }

  return {
    designNotes: truncateDesignNotesLocal(noteParts.join("\n\n")),
    designTags: tagOrdered,
  };
}

module.exports = { mergeDesignIntentFromChain, getAncestorChainIds };
