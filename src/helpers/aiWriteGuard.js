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
const ACTIVE_CONTENT_RE =
  /<\s*(script|iframe|object|embed)\b|javascript:|data:text\/html|\son[a-z]+\s*=|srcdoc\s*=/i;

/** The path of the first executable key or string in `value`, or null. */
function findActiveContent(value, path) {
  if (typeof value === "string") return ACTIVE_CONTENT_RE.test(value) ? path || "value" : null;
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
  if (tool?.annotations?.readOnlyHint) return;
  const hit = findActiveContent(args, "");
  if (!hit) return;
  throw new Error(
    `${toolName} refused: "${hit}" carries a script, embed, event handler or inject/head code. PageHub AI never writes those; the user adds snippets in Site settings → Header / Footer code, or an Embed in the editor.`
  );
}

module.exports = { assertAiWriteAllowed, findActiveContent };
