/**
 * Long string props in `get_site_node` results.
 *
 * ROOT.props.inject.head / .footer, headCode and Embed `code` routinely hold
 * 10-50k characters of CSS / JS. An agent reading ROOT for its theme or company
 * fields would otherwise carry all of it in context for the rest of the turn,
 * re-sent on every step. Reads shorten those strings to a short head plus a
 * note naming the call that returns the whole value; `prop` / `full` opt out.
 *
 * The note is distinctive on purpose: a patch that writes it back (a model
 * "extending" the shortened value) is refused by `findTruncatedPropValue`, so a
 * shortened read can never overwrite the real one.
 */

const LONG_PROP_CHARS = 1500;
const LONG_PROP_HEAD_CHARS = 200;
const TRUNCATION_MARKER = "chars truncated by get_site_node";
// A node's own copy is what an agent edits; it stays whole.
const NEVER_TRUNCATED_TOP_KEYS = new Set(["text"]);

function truncationNote(path, hidden) {
  return `…[${hidden} more ${TRUNCATION_MARKER} — call get_site_node with prop: "${path}" (or full: true) for the whole value]`;
}

/**
 * Copy of `props` with every string longer than LONG_PROP_CHARS cut to its first
 * LONG_PROP_HEAD_CHARS characters plus a note. Returns the dot paths it cut.
 */
function truncateLongProps(props) {
  const truncated = [];
  const walk = (value, path, topKey) => {
    if (typeof value === "string") {
      if (value.length <= LONG_PROP_CHARS || NEVER_TRUNCATED_TOP_KEYS.has(topKey)) return value;
      truncated.push({ path, length: value.length });
      return value.slice(0, LONG_PROP_HEAD_CHARS) + truncationNote(path, value.length - LONG_PROP_HEAD_CHARS);
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}.${i}`, topKey));
    if (value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value)) out[k] = walk(value[k], path ? `${path}.${k}` : k, topKey ?? k);
      return out;
    }
    return value;
  };
  return { props: walk(props || {}, "", undefined), truncated };
}

/** The value at a dot path inside `props` (`inject.head`, `seo.jsonLd`), or undefined. */
function readPropPath(props, path) {
  let cur = props;
  for (const key of String(path).split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Path of the first string in `value` that carries a get_site_node truncation note, or null. */
function findTruncatedPropValue(value, path = "") {
  if (typeof value === "string") return value.includes(TRUNCATION_MARKER) ? path || "value" : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findTruncatedPropValue(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      const hit = findTruncatedPropValue(value[k], path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

module.exports = {
  LONG_PROP_CHARS,
  LONG_PROP_HEAD_CHARS,
  TRUNCATION_MARKER,
  truncateLongProps,
  readPropPath,
  findTruncatedPropValue,
};
