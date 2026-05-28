/**
 * Cheap edit-distance (Levenshtein) — counts single-char inserts/deletes/swaps
 * required to turn `a` into `b`. Used by "did you mean…" suggestions when an
 * agent passes an invalid key/value and we want to surface the nearest valid
 * option instead of a silent fallback.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} edit distance
 */
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

module.exports = { editDistance };
