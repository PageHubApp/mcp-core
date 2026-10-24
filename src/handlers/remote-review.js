/**
 * Client review comments: `list_review_threads` and `reply_review_thread`. Wraps `/api/v1/sites/:id/review-threads*`,
 * the key-authenticated twin of the dashboard's Review inbox (app repo: docs/features/site-review-comments.md). The
 * viewer-side `/api/review/*` routes take a session or a guest cookie and are guarded against cross-origin writes,
 * so an API key reaches the same threads through these app-origin routes instead.
 */
const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/target");

const text = t => ({ content: [{ type: "text", text: t }] });
const threadsUrl = (siteId, threadId) => `/api/v1/sites/${encodeURIComponent(siteId)}/review-threads${threadId ? `/${encodeURIComponent(threadId)}` : ""}`;

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
const day = iso => new Date(iso).toISOString().slice(0, 16).replace("T", " ");

/** One thread: where it is pinned (the element's text, since selectors break), then the conversation. */
function threadBlock(t) {
  const where = t.anchor?.textFingerprint ? `on "${clip(t.anchor.textFingerprint, 70)}"` : `on <${String(t.anchor?.tagName || "div").toLowerCase()}> ${clip(t.anchor?.selector || "", 80)}`;
  const head = `#${t.number} [${t.status}] ${t.pageSlug ? `/${t.pageSlug}` : "home page"} ${where} (${t.id}, ${t.anchor?.viewportWidth || "?"}px wide)`;
  const msgs = (t.messages || []).map(m => `    ${m.author.name}${m.author.email ? ` <${m.author.email}>` : ""}${m.author.kind === "guest" ? " (client)" : ""}, ${day(m.createdAt)}: ${clip(m.body, 600)}`);
  return `${head}\n${msgs.join("\n")}`;
}

module.exports = {
  /**
   * @param {object} args - { id?, status?, pageSlug?, page? }
   */
  async list_review_threads(args = {}) {
    const siteId = getActiveTarget(args).id;
    const qs = new URLSearchParams({ summary: "1" });
    if (args.status) qs.set("status", args.status);
    if (args.pageSlug !== undefined) qs.set("pageSlug", String(args.pageSlug).replace(/^\//, ""));
    if (args.page) qs.set("page", String(args.page));
    const data = await call(`${threadsUrl(siteId)}?${qs}`);
    const threads = data.threads || [];
    const s = data.summary;
    const head = s ? `${s.open} open, ${s.resolved} resolved, ${s.total} in all${s.people ? `, ${s.people} people commenting` : ""}.` : `${data.openCount ?? 0} open.`;
    if (!threads.length) return text(`No review comments${args.status ? ` with status ${args.status}` : ""}. ${head}\nThe client leaves them on the preview link from the dashboard's Review screen.`);
    const p = data.pagination || {};
    return text(
      `# Review comments (${threads.length} of ${p.filteredTotal ?? threads.length}). ${head}\n\n${threads.map(threadBlock).join("\n\n")}\n\n` +
        `reply_review_thread({ threadId, body?, status? }) answers one or marks it resolved. A comment is pinned to a spot on the preview: find the markup with search_site_files on the quoted text.`
    );
  },

  /**
   * @param {object} args - { id?, threadId, body?, status? }
   */
  async reply_review_thread(args = {}) {
    const siteId = getActiveTarget(args).id;
    if (!args.threadId) throw new Error("threadId is required (from list_review_threads).");
    if (!args.body && !args.status) throw new Error("Pass body (a reply), status (open, resolved or closed), or both.");
    if (args.status && !["open", "resolved", "closed"].includes(args.status)) throw new Error("status must be open, resolved or closed.");
    const done = [];
    let thread;
    if (args.body) {
      thread = (await call(threadsUrl(siteId, args.threadId), { method: "POST", body: { body: args.body } })).thread;
      done.push("replied");
    }
    if (args.status) {
      thread = (await call(threadsUrl(siteId, args.threadId), { method: "PATCH", body: { status: args.status } })).thread;
      done.push(`marked ${args.status}`);
    }
    return text(`#${thread.number}: ${done.join(" and ")}. The site's other owners are emailed about a reply; the client sees it on their review link.\n\n${threadBlock(thread)}`);
  },
};
