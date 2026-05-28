/**
 * Icon search — for the AI agent. Searches every registered react-icons set
 * (Tabler, FontAwesome, Bootstrap, Simple Icons, …) and returns ranked,
 * resolver-ready `ref-icon:<set>/<Name>` strings.
 *
 * Lazy-built in-memory index, ~50ms cold start, free thereafter. The SDK
 * resolver lives in packages/sdk/src/utils/iconResolver.tsx — every set we
 * index here is renderable.
 */
const fs = require("fs");
const path = require("path");

// Set codes resolved from the data dir at boot. Each .json holds {Name → svgEntry}.
const ICON_DIR = path.resolve(__dirname, "../../../../packages/sdk/src/data/icon-svgs");

// Heuristic: which sets are dominated by brand/product logos. Used purely for
// the result-formatting hint ("no match in Tabler — brand not in this set").
// The resolver doesn't care what's in any set; this is just so the AI agent
// doesn't waste a round trip wondering whether `tb` was searched.
const BRAND_HEAVY_SETS = new Set(["si", "fa", "fa6", "bi", "bs", "im", "lia"]);
const UI_DEFAULT_SETS = new Set(["tb"]);

// Hardcoded react-icons prefixes per set code. Inferring this from sample
// names is unreliable (e.g. tb's first 50 names all start with "TbA" so the
// inferred prefix becomes "TbA" instead of "Tb", which silently drops
// TbPhone / TbCalendar out of strip-and-match scoring). Source of truth:
// react-icons exports — every name in `<set>.json` starts with this prefix.
const SET_PREFIX = {
  ai: "Ai",
  bi: "Bi",
  bs: "Bs",
  cg: "Cg",
  ci: "Ci",
  di: "Di",
  fa: "Fa",
  fa6: "Fa",
  fc: "Fc",
  fi: "Fi",
  gi: "Gi",
  go: "Go",
  gr: "Gr",
  hi: "Hi",
  hi2: "Hi",
  im: "Im",
  io: "Io",
  io5: "Io",
  lia: "Lia",
  lu: "Lu",
  md: "Md",
  pi: "Pi",
  ri: "Ri",
  rx: "Rx",
  si: "Si",
  sl: "Sl",
  tb: "Tb",
  tfi: "Tfi",
  ti: "Ti",
  vsc: "Vsc",
  wi: "Wi",
};

let _index = null;
function buildIndex() {
  if (_index) return _index;
  const files = fs.readdirSync(ICON_DIR).filter(f => f.endsWith(".json"));
  const entries = []; // { set, name, prefix, lower }
  const setCounts = {};
  for (const f of files) {
    const set = f.replace(/\.json$/, "");
    const data = JSON.parse(fs.readFileSync(path.join(ICON_DIR, f), "utf8"));
    const names = Object.keys(data);
    setCounts[set] = names.length;
    const prefix = SET_PREFIX[set] || "";
    for (const name of names) {
      const stripped = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
      entries.push({
        set,
        name,
        prefix,
        lower: name.toLowerCase(),
        strippedLower: stripped.toLowerCase(),
      });
    }
  }
  _index = { entries, setCounts };
  return _index;
}

/**
 * Score a name against a query. Higher = better.
 *  100  exact lowercase match (`yelp` → "yelp")
 *   95  exact match minus set prefix (`yelp` → "FaYelp")
 *   90  stripped name starts with query (`yelp` → "YelpReview")
 *   80  full name starts with query (`taby` → "TabYourThing")
 *   70  stripped contains query as whole token boundary
 *   50  stripped contains query anywhere
 *   30  full lowercase contains query anywhere
 */
function score(entry, ql) {
  if (entry.lower === ql) return 100;
  if (entry.strippedLower === ql) return 95;
  if (entry.strippedLower.startsWith(ql)) return 90;
  if (entry.lower.startsWith(ql)) return 80;
  // Token boundary (CamelCase split): matches if query starts after a capital
  if (/[A-Z]/.test(entry.name) && entry.strippedLower.includes(ql)) {
    const tokenized = entry.name.replace(/([A-Z])/g, " $1").toLowerCase();
    if (tokenized.includes(" " + ql)) return 70;
  }
  if (entry.strippedLower.includes(ql)) return 50;
  if (entry.lower.includes(ql)) return 30;
  return 0;
}

module.exports = {
  /**
   * Search for icons across every registered set.
   *
   * Args:
   *   q     — required search keyword (e.g. "yelp", "shopping cart", "phone")
   *   set   — optional, restrict to a single set (tb, fa, fa6, bi, bs, si, …)
   *   kind  — optional hint: "brand" → search brand-heavy sets (fa/fa6/si/bi/bs/im/lia),
   *           "ui" → search Tabler first. If omitted, all sets searched and ranked.
   *   limit — optional, max results (default 12, max 50).
   *
   * Returns text grouped by set, each line a copy-paste-ready `ref-icon:<set>/<Name>`.
   * If `q` would have been a Tabler hit but isn't, includes a "not in Tabler" note
   * so the agent knows it tried.
   */
  async find_icon(args) {
    const { q, set: setFilter, kind, limit: rawLimit } = args || {};
    if (!q || typeof q !== "string") {
      throw new Error("q (search keyword) is required, e.g. 'yelp', 'phone', 'shopping cart'");
    }
    const limit = Math.min(50, Math.max(1, Number(rawLimit) || 12));
    const ql = q
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    if (!ql) throw new Error("q must contain at least one non-whitespace character");

    const { entries, setCounts } = buildIndex();

    let candidatePool = entries;
    if (setFilter) {
      if (!setCounts[setFilter]) {
        throw new Error(
          `Unknown icon set "${setFilter}". Known: ${Object.keys(setCounts).sort().join(", ")}.`
        );
      }
      candidatePool = entries.filter(e => e.set === setFilter);
    } else if (kind === "brand") {
      candidatePool = entries.filter(e => BRAND_HEAVY_SETS.has(e.set));
    } else if (kind === "ui") {
      candidatePool = entries.filter(e => UI_DEFAULT_SETS.has(e.set));
    }

    const matches = [];
    for (const entry of candidatePool) {
      const s = score(entry, ql);
      if (s > 0) matches.push({ ...entry, score: s });
    }
    // Rank: score desc → prefer Tabler (UI default) on tie → shorter name → alpha.
    // Tabler tiebreaker matters most when many sets all have the same canonical
    // name (`Phone`, `Calendar`, `User`); Tb is the right default for UI icons,
    // so it should surface first when the agent isn't explicitly asking for a brand.
    const SET_PRIORITY = { tb: 0, fa: 1, fa6: 2, si: 3, bi: 4, bs: 5, im: 6, lia: 7 };
    function setRank(s) {
      return s in SET_PRIORITY ? SET_PRIORITY[s] : 100;
    }
    matches.sort(
      (a, b) =>
        b.score - a.score ||
        setRank(a.set) - setRank(b.set) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name)
    );

    const top = matches.slice(0, limit);
    const tabSearched = !setFilter || setFilter === "tb";
    const tabHit = matches.some(m => m.set === "tb");

    return {
      content: [
        {
          type: "text",
          text: format({
            q,
            top,
            totalMatches: matches.length,
            limit,
            setFilter,
            kind,
            tabSearched,
            tabHit,
          }),
        },
      ],
    };
  },
};

function format({ q, top, totalMatches, limit, setFilter, kind, tabSearched, tabHit }) {
  if (!top.length) {
    const filter = setFilter ? ` in set "${setFilter}"` : kind ? ` (kind: ${kind})` : "";
    return `No icons found for "${q}"${filter}. Try a different keyword (e.g. shorten "shopping_cart" → "cart") or remove the filter.`;
  }

  const bySet = {};
  for (const m of top) {
    if (!bySet[m.set]) bySet[m.set] = [];
    bySet[m.set].push(m);
  }

  // Stable preferred display order: tb first (for UI), then brand-heavy, then everything else.
  const PRIORITY = ["tb", "fa", "fa6", "si", "bi", "bs", "im", "lia"];
  const orderedSets = [
    ...PRIORITY.filter(s => bySet[s]),
    ...Object.keys(bySet)
      .filter(s => !PRIORITY.includes(s))
      .sort(),
  ];

  const header =
    totalMatches > limit
      ? `Found ${totalMatches} icons for "${q}" — showing top ${limit}:`
      : `Found ${totalMatches} icon${totalMatches === 1 ? "" : "s"} for "${q}":`;
  const lines = [header, ""];
  for (const set of orderedSets) {
    const setLabel = set === "tb" ? "tb (Tabler — UI default)" : set;
    lines.push(`${setLabel}:`);
    for (const m of bySet[set]) lines.push(`  ref-icon:${set}/${m.name}`);
    lines.push("");
  }

  // Helpful tail: if Tabler has no match, tell the agent — Tabler is the
  // default but doesn't carry every brand. Without this note the agent might
  // assume "I just didn't search Tabler" when the truth is "Tabler doesn't have it".
  if (tabSearched && !tabHit && !setFilter) {
    lines.push(
      `Note: no Tabler (tb) match. For UI icons Tabler is preferred — for brand/product logos use the sets above. See .claude/known-issues/tabler-missing-brand-icons.md.`
    );
  }
  if (top[0].score === 100 && top.length > 1) {
    lines.push(`Suggested: ref-icon:${top[0].set}/${top[0].name} (exact name match).`);
  }
  return lines.join("\n");
}
