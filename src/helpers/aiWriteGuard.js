/**
 * What PageHub AI may not write to a site.
 *
 * The agent's user turn carries text it didn't author — attached files, site
 * content, pasted reviews — so an instruction hidden in a PDF can steer the
 * model. Everything it writes lands in the draft and, after publish, runs on
 * the customer's live domain. Executable content is therefore refused on the
 * AI client, whatever the model's reason: inject / head code / handlers props,
 * and `<script>`, `<iframe>`, inline event handlers or `javascript:` URLs in
 * any string. People add those themselves, in Site settings or the editor.
 */

const ACTIVE_KEYS = new Set(["inject", "handlers", "headCode", "footerCode"]);
// `{% javascript %}` is a site script block; an attribute starts after whitespace, `/` or a closing quote
// (`<img/onerror=…>`, `<a href="x"onclick=…>`), and a scheme may carry entities or control characters.
const ACTIVE_CONTENT_RE =
  /<\s*(script|iframe|object|embed)\b|\{%-?\s*(javascript|endjavascript)\b|javascript:|vbscript:|data:text\/html|[\s/"'`]on[a-z]+\s*=|srcdoc\s*=/i;
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

const isActive = s => ACTIVE_CONTENT_RE.test(s) || (/[&\\\u0000-\u001f]/.test(s) && (ACTIVE_CONTENT_RE.test(decoded(s)) || SCHEME_GAP_RE.test(decoded(s))));

/** The path of the first executable key or string in `value`, or null. */
function findActiveContent(value, path) {
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
  throw new Error(
    `${toolName} refused: "${hit}" carries a script, embed, event handler or inject/head code. PageHub AI never writes those; the user adds snippets in Site settings → Header / Footer code, or an Embed in the editor.`
  );
}

module.exports = { assertAiWriteAllowed, findActiveContent };
