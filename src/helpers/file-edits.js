/**
 * Pure helpers of the HTML-first file tools (handlers/remote-files.js): exact-text edits, source positions, and the
 * "closest match" an agent gets when its `oldText` isn't in the file.
 */

/** The anchor keys of an edit: replace `oldText`, or insert `newText` right after / before an anchor that appears once. */
const ANCHORS = ["oldText", "insertAfter", "insertBefore"];

/** 1-based line of an offset in `source`. */
const lineOfOffset = (source, offset) => source.slice(0, Math.max(0, offset)).split("\n").length;

/** The 1-based lines `text` starts at in `source`, at most `max`. */
function startLines(source, text, max = 6) {
  const lines = [];
  for (let i = source.indexOf(text); i !== -1 && lines.length < max; i = source.indexOf(text, i + Math.max(1, text.length))) lines.push(lineOfOffset(source, i));
  return lines;
}

const squash = s => s.trim().replace(/\s+/g, " ");

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity of two strings by character pairs, 0..1. */
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  let shared = 0;
  for (const [g, n] of bigrams(b)) shared += Math.min(n, ga.get(g) || 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

/** How alike two normalized lines are, 0..1: one containing the other (a needle that starts or ends mid-line) is 1. */
const similar = (want, line) => (want && line.length > 3 && (line.includes(want) || (line.length > 8 && want.includes(line))) ? 1 : dice(want, line));

const clipLine = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Where `needle` most nearly is in `source`: the lines of the file that look most like it, so a retry can copy the exact
 * text. Null when nothing is similar enough to help. Compares whole lines (indentation and runs of spaces ignored)
 * and tells apart "same words, different whitespace" from a real difference.
 */
function closestMatch(source, needle) {
  const lines = source.split("\n");
  const want = needle.split("\n").slice(0, 12);
  const wantNorm = want.map(squash);
  const first = wantNorm.findIndex(l => l);
  if (first === -1 || lines.length === 0) return null;
  const norm = lines.map(squash);

  // Candidate starts: the lines most like the needle's first non-blank line, each tried with the rest of the needle.
  const candidates = norm
    .map((l, i) => ({ i, s: similar(wantNorm[first], l) }))
    .filter(c => c.s >= 0.45)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  let best = null;
  for (const c of candidates) {
    const start = c.i - first;
    let total = 0;
    for (let k = 0; k < wantNorm.length; k++) {
      const l = norm[start + k];
      total += l === undefined ? 0 : wantNorm[k] === "" && l === "" ? 1 : similar(wantNorm[k], l);
    }
    const avg = total / wantNorm.length;
    if (!best || avg > best.avg) best = { start, avg };
  }
  if (!best || best.avg < 0.55) return null;

  const at = best.start + first;
  // The needle read as one run of words is in the file's lines read the same way: only whitespace or line breaks differ.
  const sameWords = norm.slice(best.start, best.start + want.length + 1).join(" ").includes(squash(needle));
  // First character where the file's line and the needle's line part ways.
  const a = want[first];
  const b = lines[at];
  let col = 0;
  while (col < a.length && col < b.length && a[col] === b[col]) col++;
  const around = (s, c) => clipLine(s.slice(Math.max(0, c - 12), c + 28), 48);
  const shown = lines.slice(best.start, best.start + Math.min(want.length, 4)).map((l, k) => `  ${best.start + k + 1} | ${clipLine(l)}`);
  return { line: at + 1, column: col + 1, sameWords, sent: around(a, col), file: around(b, col), snippet: shown.join("\n") };
}

/** The sentence that follows "isn't in <path>": where the nearest text is and how it differs, or how to find it. */
function describeNoMatch(source, needle) {
  const m = closestMatch(source, needle);
  if (!m) return "Nothing similar is in the file: search_site_files finds the text, or read_site_file it. Copy it exactly (whitespace included).";
  const how = m.sameWords
    ? "same words, different whitespace or line breaks"
    : `you sent \`${m.sent}\`, the file has \`${m.file}\` from column ${m.column}`;
  return `Closest match: line ${m.line}, column ${m.column} (${how}):\n${m.snippet}\nCopy the text from there.`;
}

/**
 * Apply edits in order. An edit is `{ oldText, newText, replaceAll? }`, or `{ insertAfter | insertBefore, newText }`
 * which puts `newText` right after / before an anchor that appears once (the anchor itself is kept). Each anchor must
 * match once unless `replaceAll`. Throws with guidance; nothing is applied.
 */
function applyEdits(source, edits, path) {
  let out = source;
  for (const [i, e] of edits.entries()) {
    const given = ANCHORS.filter(k => e?.[k] !== undefined);
    if (given.length !== 1 || typeof e[given[0]] !== "string" || !e[given[0]]) {
      throw new Error(`edits[${i}].oldText is required (exact text from read_site_file), or insertAfter / insertBefore (text to insert next to). Give exactly one.`);
    }
    if (typeof e.newText !== "string") throw new Error(`edits[${i}].newText is required ("" deletes).`);
    const key = given[0];
    const anchor = e[key];
    const where = `${path}${i ? " (after the earlier edits of this call)" : ""}`;
    const count = out.split(anchor).length - 1;
    if (count === 0) throw new Error(`edits[${i}].${key} isn't in ${where}. ${describeNoMatch(out, anchor)} Nothing was saved.`);
    if (count > 1 && (key !== "oldText" || !e.replaceAll)) {
      throw new Error(`edits[${i}].${key} appears ${count} times in ${where} (lines ${startLines(out, anchor).join(", ")}). Add surrounding text so it's unique${key === "oldText" ? ", or set replaceAll" : ""}. Nothing was saved.`);
    }
    if (key === "oldText") {
      out = e.replaceAll ? out.split(anchor).join(e.newText) : out.replace(anchor, () => e.newText);
    } else {
      const at = out.indexOf(anchor) + (key === "insertAfter" ? anchor.length : 0);
      out = out.slice(0, at) + e.newText + out.slice(at);
    }
  }
  return out;
}

/** 1-based `line:column` of an offset in `source`. */
function lineCol(source, offset) {
  const lines = String(source).slice(0, Math.max(0, offset)).split("\n");
  return `${lines.length}:${lines[lines.length - 1].length + 1}`;
}

module.exports = { applyEdits, lineCol, closestMatch };
