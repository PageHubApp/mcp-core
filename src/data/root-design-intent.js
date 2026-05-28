/**
 * ROOT.props design intent helpers (plain JS for MCP handlers).
 * Keep limits aligned with utils/designIntent.ts.
 */
const DESIGN_NOTES_MAX = 1200;
const DESIGN_TAGS_MAX = 24;
const DESIGN_TAG_MAX_LEN = 50;

function truncateDesignNotes(s) {
  const t = String(s || "").trim();
  if (t.length <= DESIGN_NOTES_MAX) return t;
  return `${t.slice(0, DESIGN_NOTES_MAX - 1)}…`;
}

function normalizeDesignTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const seen = new Set();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const x = t.trim().slice(0, DESIGN_TAG_MAX_LEN);
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= DESIGN_TAGS_MAX) break;
  }
  return out;
}

/**
 * When applying a preset, seed designNotes/designTags if the site has none yet.
 * @param {Record<string, any>} rootProps
 * @param {Record<string, any>|null} presetRecord
 */
function stampPresetDesignIntent(rootProps, presetRecord) {
  if (!rootProps || !presetRecord) return;
  if (!rootProps.design) rootProps.design = {};
  const design = rootProps.design;
  const hasNotes = typeof design.notes === "string" && design.notes.trim();
  if (!hasNotes) {
    const bits = [
      presetRecord.description,
      Array.isArray(presetRecord.mood) && presetRecord.mood.length
        ? `Mood: ${presetRecord.mood.join(", ")}`
        : "",
      presetRecord.name ? `Theme: ${presetRecord.name}` : "",
    ].filter(Boolean);
    const joined = bits.join(" ").trim();
    if (joined) design.notes = truncateDesignNotes(joined);
  }
  if (!Array.isArray(design.tags) || design.tags.length === 0) {
    const tags = [...(presetRecord.mood || [])];
    if (presetRecord.style) tags.push(presetRecord.style);
    design.tags = normalizeDesignTags(tags);
  }
}

module.exports = {
  DESIGN_NOTES_MAX,
  truncateDesignNotes,
  normalizeDesignTags,
  stampPresetDesignIntent,
};
