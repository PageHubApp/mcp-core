/**
 * What PageHub AI may not write to a site.
 *
 * The agent's user turn carries text it didn't author — attached files, site
 * content, pasted reviews — so an instruction hidden in a PDF can steer the
 * model. Everything it writes lands in the draft and, after publish, runs on
 * the customer's live domain. Executable content is therefore refused on the
 * AI client, whatever the model's reason: inject / head code / handlers props,
 * and `<script>`, `<iframe>`, inline event handlers or `javascript:` URLs in
 * any string. `<base>` (moves every relative script and link to another host) and `<meta http-equiv>` (redirects,
 * cookies) are refused for the same reason. People add those themselves, in Site settings or the editor.
 *
 * One exception: an `<iframe>` from a trusted embed provider (`TRUSTED_IFRAMES`: YouTube, Vimeo, Google Maps,
 * Calendly, Spotify, Loom). Its `src` must be a literal https URL on that host and path (no Liquid in it), and the
 * tag may carry no handler or `srcdoc`. A hidden instruction can then only embed one of those players.
 *
 * Edits are judged by what they add. An edit's `oldText` and anchors are already in the file, so they aren't checked,
 * and its `newText` may repeat a script, tag or handler from them word for word (`editAddsActiveContent`). An imported
 * page keeps its own scripts; without this the AI could not touch any markup near one. A hidden instruction can then
 * only copy code the site already runs.
 */

const ACTIVE_KEYS = new Set(["inject", "handlers", "headCode", "footerCode"]);
// `{% javascript %}` is a site script block; an attribute starts after whitespace, `/` or a closing quote
// (`<img/onerror=…>`, `<a href="x"onclick=…>`), and a scheme may carry entities or control characters.
const ACTIVE_CONTENT_RE =
  /<\s*(script|iframe|object|embed|base|frame|frameset|applet|portal)\b|<\s*meta\b[^>]*\bhttp-equiv|\{%-?\s*(javascript|endjavascript)\b|javascript:|vbscript:|data:text\/html|[\s/"'`]on[a-z]+\s*=|srcdoc\s*=/i;
/** A site script file (`assets/<name>.js`): plain JavaScript, so no markup pattern can see it. */
const SCRIPT_PATH_RE = /^\s*\/?assets\/.*\.js\s*$/i;

const NAMED_ENTITIES = { colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", sol: "/", bsol: "\\", lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };

/**
 * The text a browser would act on: HTML character references decoded (`java&#115;cript:`, `&colon;`) and the
 * characters a URL scheme ignores removed (`java\tscript:`), so the pattern above sees the scheme.
 */
function decoded(s) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}
const safeChar = n => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");
const SCHEME_GAP_RE = /(j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t)\s*:/i;

/** Embed players PageHub AI may frame: exact host, and the path its embed URLs start with. */
const TRUSTED_IFRAMES = [
  ["www.youtube.com", "/embed/"],
  ["youtube.com", "/embed/"],
  ["www.youtube-nocookie.com", "/embed/"],
  ["player.vimeo.com", "/video/"],
  ["www.google.com", "/maps/embed"],
  ["calendly.com", "/"],
  ["open.spotify.com", "/embed/"],
  ["www.loom.com", "/embed/"],
];
const IFRAME_OPEN_RE = /<\s*iframe\b([^>]*)>/gi;
// `src` as its own attribute (whitespace before it), never `data-src`; one `src` only, since a browser reads the first.
const IFRAME_SRC_RE = /(?:^|\s)src\s*=\s*(["'])https:\/\/([a-z0-9.-]+)(\/[^"'{}<>\s]*)\1/i;
const IFRAME_SRC_COUNT_RE = /(?:^|\s)src\s*=/gi;
const IFRAME_UNSAFE_ATTR_RE = /[\s/"'`]on[a-z]+\s*=|srcdoc\s*=|\{[{%]/i;

function isTrustedIframe(attrs) {
  for (const a of [attrs, decoded(attrs)]) {
    if (IFRAME_UNSAFE_ATTR_RE.test(a)) return false;
    if ((a.match(IFRAME_SRC_COUNT_RE) || []).length !== 1) return false;
    const src = IFRAME_SRC_RE.exec(a);
    if (!src) return false;
    const host = src[2].toLowerCase();
    if (!TRUSTED_IFRAMES.some(([h, p]) => host === h && src[3].startsWith(p))) return false;
  }
  return true;
}

/** `s` with every trusted embed iframe's opening tag removed, so the patterns below judge the rest. */
const withoutTrustedIframes = s => (/<\s*iframe/i.test(s) ? s.replace(IFRAME_OPEN_RE, (tag, attrs) => (isTrustedIframe(attrs) ? "" : tag)) : s);

const isActive = raw => {
  const s = withoutTrustedIframes(raw);
  return ACTIVE_CONTENT_RE.test(s) || (/[&\\\u0000-\u001f]/.test(s) && (ACTIVE_CONTENT_RE.test(decoded(s)) || SCHEME_GAP_RE.test(decoded(s))));
};

// The executable pieces of markup, as they appear in the text: script and `{% javascript %}` blocks, active tags
// (`<iframe …>`, `<base …>`), and attributes (`onclick="…"`, `href="javascript:…"`).
const SCRIPT_BLOCK_RE = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>|\{%-?\s*javascript\s*-?%\}[\s\S]*?\{%-?\s*endjavascript\s*-?%\}/gi;
const TAG_RE = /<[^<>]*>/g;
const ATTR_RE = /[a-z_:][-a-z0-9_:.]*\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s"'`=<>]+)/gi;

/** Every executable piece of `text`, longest first. */
function activePieces(text) {
  const pieces = new Set();
  for (const m of text.match(SCRIPT_BLOCK_RE) || []) pieces.add(m);
  for (const tag of text.replace(SCRIPT_BLOCK_RE, "").match(TAG_RE) || []) {
    if (!isActive(tag)) continue;
    pieces.add(tag);
    for (const attr of tag.match(ATTR_RE) || []) if (isActive(` ${attr}`)) pieces.add(attr);
  }
  return [...pieces].sort((a, b) => b.length - a.length);
}

/**
 * Whether an edit's `newText` adds executable content. Its `oldText` / `insertAfter` / `insertBefore` are already in
 * the file, so a script, tag or handler copied from them word for word is not new: an imported gallery whose images
 * carry `onclick="openLightbox(this)"` can gain an image like the others. Anything else executable is refused.
 */
function editAddsActiveContent(edit) {
  const newText = typeof edit?.newText === "string" ? edit.newText : "";
  if (!isActive(newText)) return false;
  const existing = [edit.oldText, edit.insertAfter, edit.insertBefore].filter(s => typeof s === "string").join("\n");
  let rest = newText;
  for (const piece of activePieces(existing)) rest = rest.split(piece).join(" ");
  return isActive(rest);
}

/** The path of the first executable key or string in `value`, or null. */
function findActiveContent(value, path) {
  if (path && /(^|\.)edits$/.test(path) && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const edit = value[i];
      if (!edit || typeof edit !== "object") continue;
      if (editAddsActiveContent(edit)) return `${path}[${i}].newText`;
      const { oldText: _o, insertAfter: _a, insertBefore: _b, newText: _n, ...other } = edit;
      const hit = findActiveContent(other, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "string") {
    if (/(^|\.)(path|paths\[\d+\])$/.test(path || "") && SCRIPT_PATH_RE.test(value)) return path;
    return isActive(value) ? path || "value" : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findActiveContent(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      const next = path ? `${path}.${key}` : key;
      if (ACTIVE_KEYS.has(key)) return next;
      const hit = findActiveContent(value[key], next);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Throws when an AI-client call to a writing tool carries executable content.
 * `tool` is the tools.json entry (its `readOnlyHint` exempts reads, where a
 * search string may legitimately mention a tag).
 */
function assertAiWriteAllowed(toolName, args, ctx, tool) {
  if (!ctx || ctx.client !== "ai") return;
  if (toolName === "set_integrations" && args?.googleTagManager) {
    throw new Error("set_integrations refused: a Google Tag Manager container runs any script on the live site. PageHub AI never sets one; the user sets it in Site settings → Integrations.");
  }
  if (tool?.annotations?.readOnlyHint) return;
  const hit = findActiveContent(args, "");
  if (!hit) return;
  const copyHint = hit.endsWith(".newText")
    ? " A script, tag or handler the page already has may be repeated word for word: include the existing markup that carries it in oldText (or the anchor) and copy it exactly."
    : "";
  throw new Error(
    `${toolName} refused: "${hit}" carries a script, embed, event handler or inject/head code. PageHub AI never writes those; the user adds snippets in Site settings → Header / Footer code, or an Embed in the editor.${copyHint}`
  );
}

module.exports = { assertAiWriteAllowed, findActiveContent, TRUSTED_IFRAMES };
