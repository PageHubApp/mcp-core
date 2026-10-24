/**
 * Site history: `list_site_history` (the revision timeline, or one revision with what changed) and
 * `restore_site_revision` (a revision back into the DRAFT). Wraps `/api/v1/sites/:id/history*`, the key-authenticated
 * twin of the dashboard's History screen (app repo: docs/features/site-history.md). A restore never touches the live
 * release: the author reviews the draft and publishes.
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget, getEditorUrl } = require("../helpers/target");

const text = t => ({ content: [{ type: "text", text: t }] });
const historyUrl = (siteId, revId, tail = "") => `/api/v1/sites/${encodeURIComponent(siteId)}/history${revId ? `/${encodeURIComponent(revId)}` : ""}${tail}`;

/** The unified diff of one file is capped so a rewrite of a big page can't fill the context. */
const MAX_DIFF_LINES = 60;
const MAX_TOTAL_CHARS = 14000;

async function call(url, opts) {
  try {
    return await apiFetch(url, opts);
  } catch (err) {
    const b = err?.body || {};
    if (b.error === "maintenance") throw new Error(`PageHub is in maintenance, so edits are paused: ${b.message || "try again later"}. Nothing was changed; tell the user and stop.`);
    if (b.code === "LEGACY_REVISION") throw new Error("That version was saved before the HTML editor: it is listed for the record but can't be compared or restored.");
    if (b.code === "PRE_RESTORE_BACKUP_FAILED") throw new Error("The safety backup before the restore failed, so NOTHING was changed. Try again; if it keeps failing, tell the user.");
    if (err?.status === 403) throw new Error(b.message || b.error || "This key can't change this site's history (needs owner, editor or agency access).");
    throw err;
  }
}

function when(iso) {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function revisionLine(r) {
  const s = r.stats ? ` (+${r.stats.added} -${r.stats.removed} ~${r.stats.changed})` : "";
  const by = r.source ? `${r.author} via ${r.source}` : r.author;
  const flag = r.restorable ? "" : " [view only: older format]";
  return `• ${r.id} — v${r.version} ${r.trigger}, ${when(r.updatedAt || r.createdAt)}, ${by}${s}${r.summary ? `: ${r.summary}` : ""}${flag}`;
}

/** One revision's changes, grouped by page; `path` narrows it to one file with its whole (capped) diff. */
function describeChanges(data, path) {
  const out = [];
  let used = 0;
  for (const g of data.groups || []) {
    const changes = path ? g.changes.filter(c => c.nodeId === path) : g.changes;
    if (!changes.length) continue;
    out.push(`\n## ${g.pageLabel}${g.pageNodeId ? ` (${g.pageNodeId})` : ""}`);
    for (const c of changes) {
      out.push(`- ${c.status} ${c.type}: ${c.label} [${c.nodeId}]`);
      for (const f of c.fields || []) {
        const body = f.unified || (f.before !== undefined || f.after !== undefined ? `${JSON.stringify(f.before)} -> ${JSON.stringify(f.after)}` : "");
        if (!body) continue;
        const lines = String(body).split("\n");
        const shown = path ? lines : lines.slice(0, MAX_DIFF_LINES);
        const chunk = `  ${f.label}:\n${shown.map(l => `    ${l}`).join("\n")}${shown.length < lines.length ? `\n    … ${lines.length - shown.length} more lines (pass path: "${c.nodeId}" for the whole diff)` : ""}`;
        if (used + chunk.length > MAX_TOTAL_CHARS) {
          out.push(`  … output capped; pass path: "<file>" to read one file's diff.`);
          return out.join("\n");
        }
        used += chunk.length;
        out.push(chunk);
      }
    }
  }
  return out.join("\n");
}

module.exports = {
  /**
   * @param {object} args - { id?, revisionId?, diff?, path?, page?, pageSize? }
   */
  async list_site_history(args = {}) {
    const siteId = getActiveTarget(args).id;
    if (args.revisionId) {
      const qs = new URLSearchParams({ diff: args.diff || "prev" });
      const data = await call(historyUrl(siteId, args.revisionId, `?${qs}`));
      const r = data.revision;
      const head = `# Revision ${r.id}: v${r.version} ${r.trigger}, ${when(r.createdAt)}, ${r.author}${r.summary ? ` — ${r.summary}` : ""}${r.restorable ? "" : " [view only: older format]"}`;
      const vs = data.baseline ? `compared with v${data.baseline.version} (${data.baseline.id})` : "no earlier version to compare with";
      const stats = data.stats ? `${data.stats.added} added, ${data.stats.removed} removed, ${data.stats.changed} changed` : "";
      const body = describeChanges(data, args.path);
      return text(`${head}\n${vs}${stats ? `; ${stats}` : ""}${data.truncated ? ` (showing the first 500 of ${data.totalChanges})` : ""}\n${body || "\nNo changes."}\n\nrestore_site_revision({ revisionId: "${r.id}" }) puts this version in the draft.`);
    }
    const qs = new URLSearchParams();
    if (args.page) qs.set("page", String(args.page));
    if (args.pageSize) qs.set("pageSize", String(args.pageSize));
    const data = await call(historyUrl(siteId, null, qs.toString() ? `?${qs}` : ""));
    const rows = data.revisions || [];
    if (!rows.length) return text("No revisions yet: history records a version when the site is saved, published or restored.");
    const p = data.pagination || {};
    return text(
      `# Site history (newest first), ${rows.length} of ${p.total ?? rows.length}${p.totalPages > 1 ? `, page ${p.page} of ${p.totalPages}` : ""}\n` +
        `Keeps the latest ${data.retention?.cap ?? "?"} versions on the ${data.retention?.plan ?? "?"} plan.\n\n${rows.map(revisionLine).join("\n")}\n\n` +
        `list_site_history({ revisionId }) shows what changed in one; restore_site_revision({ revisionId }) puts it in the draft.`
    );
  },

  /**
   * @param {object} args - { id?, revisionId, scope?, pageNodeId? }
   */
  async restore_site_revision(args = {}) {
    const siteId = getActiveTarget(args).id;
    if (!args.revisionId) throw new Error("revisionId is required (from list_site_history).");
    // Review mode stages file writes for the person to keep or discard; a restore writes the draft itself.
    if (getContext().stageFileEdits) throw new Error("A restore writes the draft directly, so it isn't available while PageHub AI's changes are waiting for review. Ask the user to keep or discard them first. Nothing was changed.");
    const scope = args.scope === "page" ? "page" : "site";
    if (scope === "page" && !args.pageNodeId) throw new Error('scope "page" needs pageNodeId (from list_site_history with that revisionId).');
    const r = await call(historyUrl(siteId, args.revisionId, "/restore"), { method: "POST", body: { scope, ...(args.pageNodeId ? { pageNodeId: args.pageNodeId } : {}) } });
    getContext()._sourceFilesWritten = true;
    return text(
      `${r.summary}. ${scope === "page" ? "1 page" : `${(r.restoredPages || []).length} page(s)`} restored into the DRAFT as v${r.newVersion ?? "?"}; the live site is unchanged until publish_site.\n` +
        `The state before the restore is kept: a safety backup, and the previous version in list_site_history, so this can be undone.\nEditor: ${getEditorUrl(siteId)}`
    );
  },
};
