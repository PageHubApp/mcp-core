/**
 * Form submissions and their webhooks: `list_form_submissions` (the inbox, or one submission),
 * `resend_form_webhook`, `list_form_webhooks` and `set_form_webhook_secret`. Wraps `/api/v1/sites/:id/submissions*`
 * and `/api/v1/sites/:id/form-webhooks`, the key-authenticated twins of the dashboard's Form submissions screen (app
 * repo: docs/features/submission-inbox.md, docs/features/form-webhooks.md).
 */
const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/target");

const text = t => ({ content: [{ type: "text", text: t }] });
const siteUrl = siteId => `/api/v1/sites/${encodeURIComponent(siteId)}`;

async function call(url, opts) {
  try {
    return await apiFetch(url, opts);
  } catch (err) {
    const b = err?.body || {};
    if (b.error === "maintenance") throw new Error(`PageHub is in maintenance, so edits are paused: ${b.message || "try again later"}. Nothing was changed; tell the user and stop.`);
    if (err?.status === 403 && b.message) throw new Error(b.message);
    throw err;
  }
}

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const when = iso => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") : "");

/** "Delivered", "Failed (500) after 6 attempts", "Retrying: 2 attempts so far, next 14:05": the owner's wording. */
function deliveryLine(w) {
  if (!w) return "";
  if (w.status === "delivered") return `webhook delivered${w.deliveredAt ? ` ${when(w.deliveredAt)}` : ""}`;
  const n = `${w.attempts} attempt${w.attempts === 1 ? "" : "s"}`;
  if (w.status === "failed") return `webhook FAILED${w.lastHttpStatus ? ` (${w.lastHttpStatus})` : ""} after ${n}${w.lastError ? `: ${clip(w.lastError, 120)}` : ""}`;
  return `webhook pending: ${n} so far${w.nextAttemptAt ? `, next ${when(w.nextAttemptAt)}` : ""}${w.lastError ? `, last: ${clip(w.lastError, 100)}` : ""}`;
}

function answersOf(data) {
  return Object.entries(data || {})
    .map(([k, v]) => `${k}: ${clip(Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v, 200)}`)
    .join(" | ");
}

function submissionLine(s) {
  const unread = s.readAt ? "" : " [unread]";
  return `• ${s._id} — ${s.formName} on ${s.pagePath || "/"}, ${when(s.createdAt)}, ${s.state}${unread}\n    ${clip(answersOf(s.data), 300)}${s.webhook ? `\n    ${deliveryLine(s.webhook)} → ${s.webhook.url}` : ""}`;
}

module.exports = {
  /**
   * @param {object} args - { id?, submissionId?, state?, formName?, q?, cursor?, limit? }
   */
  async list_form_submissions(args = {}) {
    const siteId = getActiveTarget(args).id;
    if (args.submissionId) {
      const { submission: s } = await call(`${siteUrl(siteId)}/submissions/${encodeURIComponent(args.submissionId)}`);
      const lines = [`# Submission ${s._id}: ${s.formName} on ${s.pagePath || "/"}, ${when(s.createdAt)}, ${s.state}`, "", "Answers:"];
      for (const [k, v] of Object.entries(s.data || {})) lines.push(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      if (s.attribution && Object.keys(s.attribution).length) lines.push("", `Came from: ${Object.entries(s.attribution).map(([k, v]) => `${k}=${clip(v, 80)}`).join(", ")}`);
      if (s.webhook) {
        lines.push("", `Webhook: ${deliveryLine(s.webhook)} → ${s.webhook.url}`);
        if (s.webhook.status !== "delivered") lines.push(`resend_form_webhook({ submissionId: "${s._id}" }) tries again from the start (owners only).`);
      }
      const notes = (s.activity || []).slice(-10).map(a => `  ${when(a.at)} ${a.kind}${a.text ? `: ${clip(a.text, 200)}` : ""}${a.actorEmail ? ` (${a.actorEmail})` : ""}`);
      if (notes.length) lines.push("", "Activity:", ...notes);
      return text(lines.join("\n"));
    }
    const qs = new URLSearchParams();
    for (const k of ["state", "formName", "q", "cursor"]) if (args[k]) qs.set(k, String(args[k]));
    if (args.limit) qs.set("limit", String(args.limit));
    const data = await call(`${siteUrl(siteId)}/submissions${qs.toString() ? `?${qs}` : ""}`);
    const rows = data.submissions || [];
    const sum = data.summary;
    const head = sum ? `Inbox: ${Object.entries(sum.states || {}).map(([k, v]) => `${v} ${k}`).join(", ")}; ${sum.unread} unread, ${sum.total} in all. ` : "";
    const forms = data.formNames?.length ? `Forms: ${data.formNames.join(", ")}. ` : "";
    if (!rows.length) return text(`${head}${forms}No ${args.state || "open"} submissions${args.q ? ` matching "${args.q}"` : ""}.`);
    return text(
      `# Form submissions (${args.state || "open"}), newest first\n${head}${forms}\n\n${rows.map(submissionLine).join("\n\n")}\n\n` +
        `${data.hasMore ? `More: pass cursor: "${data.nextCursor}". ` : ""}list_form_submissions({ submissionId }) reads one in full, with how the visitor arrived.`
    );
  },

  /**
   * @param {object} args - { id?, submissionId }
   */
  async resend_form_webhook(args = {}) {
    const siteId = getActiveTarget(args).id;
    if (!args.submissionId) throw new Error("submissionId is required (from list_form_submissions).");
    const { webhook } = await call(`${siteUrl(siteId)}/submissions/${encodeURIComponent(args.submissionId)}/webhook`, { method: "POST", body: {} });
    return text(
      `Queued again from the start: ${deliveryLine(webhook)} → ${webhook.url}.\nIt goes to the form's CURRENT webhook URL, signed with the current secret, with the same submissionId (receivers dedupe on it). Check list_form_submissions({ submissionId: "${args.submissionId}" }) in a minute.`
    );
  },

  /**
   * @param {object} args - { id? }
   */
  async list_form_webhooks(args = {}) {
    const siteId = getActiveTarget(args).id;
    const { destinations } = await call(`${siteUrl(siteId)}/form-webhooks`);
    if (!destinations.length) {
      return text("No form on the PUBLISHED site posts to a webhook. Add `webhook: 'https://…'` to a {% form %} tag, then publish_site: webhooks are read from the live release.");
    }
    const lines = destinations.map(d => `• ${d.url} [endpoint: ${d.endpoint}]\n    forms: ${d.forms.join(", ")}\n    signing secret: ${d.hasSecret ? `set${d.rotatedAt ? `, changed ${when(d.rotatedAt)}` : ""}` : "none yet (one is made on the first delivery)"}`);
    return text(
      `# Form webhooks on the live site\n\n${lines.join("\n\n")}\n\n` +
        `Deliveries are signed: X-PageHub-Signature: sha256=<hex HMAC-SHA256 of "<X-PageHub-Timestamp>.<raw body>">. set_form_webhook_secret({ endpoint, action }) rotates or sets the secret. A secret is never shown again after it is made.`
    );
  },

  /**
   * @param {object} args - { id?, endpoint, action: "rotate"|"set", secret? }
   */
  async set_form_webhook_secret(args = {}) {
    const siteId = getActiveTarget(args).id;
    if (!args.endpoint) throw new Error("endpoint is required: the `endpoint` key list_form_webhooks returns.");
    if (args.action !== "rotate" && args.action !== "set") throw new Error('action must be "rotate" (PageHub makes a new secret) or "set" (store the secret the receiver issued, in `secret`).');
    if (args.action === "set" && !args.secret) throw new Error("secret is required with action set: 16 to 256 characters, no spaces.");
    const r = await call(`${siteUrl(siteId)}/form-webhooks`, { method: "POST", body: { endpoint: args.endpoint, action: args.action, ...(args.action === "set" ? { secret: args.secret } : {}) } });
    if (args.action === "rotate") {
      return text(
        `New signing secret (shown ONCE, give it to the user to put in the receiver, don't paste it into the site):\n${r.secret}\n\nThe old secret stopped working now: deliveries sign with this one, so a receiver still holding the old one answers 401 until it is updated. resend_form_webhook retries a failed one.`
      );
    }
    return text("Secret stored (encrypted; it can't be read back). Deliveries are signed with it from the next attempt.");
  },
};
