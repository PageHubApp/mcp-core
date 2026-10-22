/**
 * Pure helpers of the HTML-first file tools (handlers/remote-files.js): exact-text replacement and source positions.
 */

/** Apply exact-text replacements in order; each `oldText` must match once unless `replaceAll`. Throws with guidance. */
function applyEdits(source, edits, path) {
  let out = source;
  for (const [i, e] of edits.entries()) {
    if (typeof e?.oldText !== "string" || !e.oldText) throw new Error(`edits[${i}].oldText is required (exact text from read_site_file).`);
    if (typeof e.newText !== "string") throw new Error(`edits[${i}].newText is required ("" deletes).`);
    const count = out.split(e.oldText).length - 1;
    if (count === 0) throw new Error(`edits[${i}].oldText isn't in ${path}. Copy it exactly from read_site_file (whitespace included). Nothing was saved.`);
    if (count > 1 && !e.replaceAll) {
      throw new Error(`edits[${i}].oldText appears ${count} times in ${path}. Add surrounding text so it's unique, or set replaceAll. Nothing was saved.`);
    }
    out = e.replaceAll ? out.split(e.oldText).join(e.newText) : out.replace(e.oldText, () => e.newText);
  }
  return out;
}

/** 1-based `line:column` of an offset in `source`. */
function lineCol(source, offset) {
  const lines = String(source).slice(0, Math.max(0, offset)).split("\n");
  return `${lines.length}:${lines[lines.length - 1].length + 1}`;
}

module.exports = { applyEdits, lineCol };
