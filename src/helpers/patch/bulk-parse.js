/**
 * Recovery heuristics for bulk-patch input arriving as malformed model JSON.
 * Handles: markdown fences, smart quotes, trailing commas, swapped ]}→}],
 * array-like objects, and per-element parsing when the whole array fails.
 * None of this is "nice to have" — model outputs routinely trip each case.
 */

const { parseMaybeJson } = require("../args");

/**
 * Parse patches JSON string; tolerate markdown fences and trailing commas (common model mistakes).
 */
function parseBulkPatchesJsonString(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  if (!trimmed) return null;
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const smartQuotes = unfenced.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const variants = [unfenced, smartQuotes];
  const attempts = [];
  for (const v of variants) {
    attempts.push(v, v.replace(/,\s*([\]}])/g, "$1"));
    // Also try repairing swapped ]} → }] (common model mistake)
    const repaired = v.replace(/"\s*\]\s*\}/g, (m, offset) => {
      const lastOpen = v.lastIndexOf("{", offset);
      const lastClose = v.lastIndexOf("}", offset);
      if (lastOpen > lastClose) return '"}]';
      return m;
    });
    if (repaired !== v) {
      attempts.push(repaired, repaired.replace(/,\s*([\]}])/g, "$1"));
    }
  }
  for (const s of attempts) {
    try {
      return JSON.parse(s);
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Split `[a,b,c]` inner by commas at depth 0 (respects strings). */
function splitTopLevelCommaSeparatedJsonValues(inner) {
  const segs = [];
  let depth = 0;
  let start = 0;
  let inString = false;
  let esc = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inString) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    if (c === "," && depth === 0) {
      segs.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  segs.push(inner.slice(start).trim());
  return segs.filter(x => x.length > 0);
}

/**
 * When the full array string fails JSON.parse, try parsing each `{...}` segment (models often break only one object).
 */
function tryParseBulkPatchArrayElementsFromString(raw) {
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  if (!unfenced.startsWith("[") || !unfenced.endsWith("]")) return null;
  const inner = unfenced.slice(1, -1).trim();
  if (!inner) return [];
  const segs = splitTopLevelCommaSeparatedJsonValues(inner);
  const out = [];
  for (const seg of segs) {
    const frag = seg.trim();
    if (!frag.startsWith("{")) return null;
    let parsed;
    try {
      parsed = JSON.parse(frag);
    } catch {
      try {
        parsed = JSON.parse(frag.replace(/,\s*}$/, "}"));
      } catch {
        return null;
      }
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.nodeId !== "string") return null;
    out.push(parsed);
  }
  return out.length > 0 ? out : null;
}

/**
 * Coerce patch_site_bulk input from common model mistakes into an array of patch objects.
 * Handles: JSON string, single { nodeId, ... }, { patches: [...] }, array-like { "0": {...} }.
 */
function normalizeBulkPatchesFromArgs(args = {}) {
  let list = args.patches != null ? args.patches : args.patch;
  let safety = 0;
  while (list != null && safety++ < 10) {
    if (typeof list === "string") {
      const trimmed = list.trim();
      if (!trimmed) return null;
      let next = parseMaybeJson(trimmed);
      if (next === list) {
        next = parseBulkPatchesJsonString(trimmed);
      }
      if (next == null || next === list) {
        next = tryParseBulkPatchArrayElementsFromString(trimmed);
      }
      if (next == null || next === list) return null;
      list = next;
      continue;
    }
    if (Array.isArray(list)) {
      return list.filter(x => x != null && typeof x === "object");
    }
    if (typeof list === "object") {
      if (typeof list.nodeId === "string") {
        return [list];
      }
      if (Array.isArray(list.patches)) {
        list = list.patches;
        continue;
      }
      const keys = Object.keys(list);
      if (keys.length && keys.every(k => /^\d+$/.test(k))) {
        return keys
          .sort((a, b) => Number(a) - Number(b))
          .map(k => list[k])
          .filter(x => x != null && typeof x === "object");
      }
      return null;
    }
    return null;
  }
  return null;
}

module.exports = {
  parseBulkPatchesJsonString,
  splitTopLevelCommaSeparatedJsonValues,
  tryParseBulkPatchArrayElementsFromString,
  normalizeBulkPatchesFromArgs,
};
