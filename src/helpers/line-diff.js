/**
 * A short diff of only the lines that differ, for telling an agent how the stored file differs from what it sent
 * (handlers/remote-files.js). Common lines at the top and bottom are trimmed, the middle is diffed by longest common
 * subsequence, and equal lines inside it are left out, so the answer is the changed lines and where they are.
 */

/** Past this many line pairs the middle is shown as one replaced block instead of diffed. */
const MAX_LCS_CELLS = 250_000;

/** Edit script of `a` → `b` as `[op, line, index in b]` with op "-", "+" or " ". */
function lcsScript(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_LCS_CELLS) return [...a.map(l => ["-", l, 0]), ...b.map((l, j) => ["+", l, j])];
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([" ", a[i], j]);
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) out.push(["-", a[i++], j]);
    else out.push(["+", b[j], j++]);
  }
  while (i < n) out.push(["-", a[i++], j]);
  while (j < m) out.push(["+", b[j], j++]);
  return out;
}

const clip = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * `-sent` / `+stored` lines under `@@ line N @@` headers (N is the line in `b`, the stored text). "" when equal.
 * At most `max` changed lines are shown; the rest are counted.
 */
function lineDiff(a, b, { max = 24 } = {}) {
  if (a === b) return "";
  const A = a.split("\n");
  const B = b.split("\n");
  let top = 0;
  while (top < A.length && top < B.length && A[top] === B[top]) top++;
  let bottom = 0;
  while (bottom < A.length - top && bottom < B.length - top && A[A.length - 1 - bottom] === B[B.length - 1 - bottom]) bottom++;
  const script = lcsScript(A.slice(top, A.length - bottom), B.slice(top, B.length - bottom));

  const out = [];
  let shown = 0;
  let hidden = 0;
  let inHunk = false;
  for (const [op, line, j] of script) {
    if (op === " ") {
      inHunk = false;
      continue;
    }
    if (shown >= max) {
      hidden++;
      continue;
    }
    if (!inHunk) {
      out.push(`@@ line ${top + j + 1} @@`);
      inHunk = true;
    }
    out.push(`${op}${clip(line)}`);
    shown++;
  }
  if (hidden) out.push(`… ${hidden} more changed line${hidden === 1 ? "" : "s"}`);
  return out.join("\n");
}

module.exports = { lineDiff };
