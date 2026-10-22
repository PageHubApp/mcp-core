/**
 * File tools for HTML-first sites: list, read, search, write, edit and delete the draft's HTML + Liquid files through
 * `/api/v1/sites/:id/files` (app repo: docs/features/html-first-ai-mcp.md). Every write goes through the server's one
 * write seam (lint, sanitize, version check, maintenance freeze); an agent write is untrusted, so `on*` handlers it
 * adds are stripped. A Craft site answers `site_format_changed`, which these turn into "use the node tools".
 *
 * A file's version is its content hash. `edit_site_file` reads the file, applies exact-text replacements and writes
 * against the version it read, so an edit can never silently overwrite someone else's change to the same file.
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget } = require("../helpers/target");
const { applyEdits, lineCol } = require("../helpers/file-edits");

const text = t => ({ content: [{ type: "text", text: t }] });

function siteOf(args) {
  const target = getActiveTarget(args);
  if (target.type !== "site") throw new Error("File tools work on sites, not templates.");
  return target.id;
}

const filesUrl = (siteId, path) =>
  `/api/v1/sites/${encodeURIComponent(siteId)}/files${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`;

/** Turn the files API's refusals into what the agent should do next. Rethrows anything else. */
function explain(err, { path, sent }) {
  const body = err?.body || {};
  if (body.error === "site_format_changed") {
    throw new Error(`This site is not an HTML-first site (it has a node tree). Use list_site_nodes / patch_site_node instead of file tools.`);
  }
  if (body.error === "lint") {
    const issues = (body.issues || [])
      .slice(0, 8)
      .map(i => `  - ${typeof sent === "string" && i.range ? `line ${lineCol(sent, i.range.start)}` : ""} [${i.rule}] ${i.message}`)
      .join("\n");
    throw new Error(`${body.path || path} was NOT saved: it breaks the HTML-first rules.\n${issues}\nFix those spots and write again.`);
  }
  if (body.error === "version_conflict") {
    throw new Error(`${path} changed since you read it (or already exists). Nothing was saved. read_site_file it again and redo the edit on the current text.`);
  }
  if (body.error === "maintenance") {
    throw new Error(`PageHub is in maintenance, so edits are paused: ${body.message || "try again later"}. Nothing was saved; tell the user and stop.`);
  }
  throw err;
}

/**
 * Record that a file tool changed something. In review mode (`stageFileEdits`: the dashboard chat with the editor open)
 * the server staged the edit for the person to keep or discard instead of writing the draft, which the turn's `done`
 * event reports as `stagedForReview`.
 */
function markWritten() {
  const ctx = getContext();
  if (ctx.stageFileEdits) ctx._sourceFilesStaged = true;
  else ctx._sourceFilesWritten = true;
}

/** The sentence that ends a write's reply: where the change is now. */
const whereNow = (what, staged = getContext().stageFileEdits) =>
  staged
    ? `${what} staged for review: the person keeps or discards it, so it is not in the draft yet. read_site_file shows it.`
    : `${what} Not live until publish_site.`;

async function readFile(siteId, path) {
  try {
    return await apiFetch(filesUrl(siteId, path));
  } catch (err) {
    if (err?.body?.error === "file_not_found") throw new Error(`${path} doesn't exist. list_site_files shows the files.`);
    return explain(err, { path });
  }
}

async function putFile(siteId, path, sent, baseVersion) {
  try {
    const res = await apiFetch(filesUrl(siteId, path), { method: "PUT", body: { text: sent, baseVersion: baseVersion || null } });
    markWritten();
    return res;
  } catch (err) {
    return explain(err, { path, sent });
  }
}

module.exports = {
  async list_site_files(args = {}) {
    const siteId = siteOf(args);
    let listed;
    try {
      listed = await apiFetch(filesUrl(siteId));
    } catch (err) {
      return explain(err, { path: "" });
    }
    const pages = (await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/source-pages`)).pages || [];
    const byFile = new Map(pages.filter(p => p.file).map(p => [p.file, p]));
    const lines = listed.paths.map(p => {
      const page = byFile.get(p);
      return `${p}${page ? `  → page ${page.pageId} at ${page.url}${page.isHomePage ? " (home)" : ""}` : ""}`;
    });
    return text(
      `Files of site ${siteId} (draft version ${listed.version}):\n${lines.join("\n")}\n\nread_site_file to read one; edit_site_file to change it. Format rules: get_style_reference({ topic: "liquid" }).`
    );
  },

  async read_site_file(args = {}) {
    const siteId = siteOf(args);
    if (!args.path) throw new Error("path is required, e.g. pages/index.liquid (list_site_files shows them).");
    const file = await readFile(siteId, args.path);
    const all = String(file.text).split("\n");
    const start = Math.max(1, Number(args.startLine) || 1);
    const end = Math.min(all.length, Number(args.endLine) || all.length);
    const ranged = start > 1 || end < all.length;
    const body = ranged ? all.slice(start - 1, end).join("\n") : file.text;
    return text(
      `${args.path} — version ${file.version}, ${all.length} lines${ranged ? `; showing lines ${start}–${end}` : ""}.\n\`\`\`liquid\n${body}\n\`\`\``
    );
  },

  async search_site_files(args = {}) {
    const siteId = siteOf(args);
    const q = String(args.query || "");
    if (!q.trim()) throw new Error("query is required.");
    const params = new URLSearchParams({ q, ...(args.path ? { path: String(args.path) } : {}) });
    let found;
    try {
      found = await apiFetch(`${filesUrl(siteId)}?${params}`);
    } catch (err) {
      return explain(err, { path: "" });
    }
    if (!found.matches.length) return text(`No file contains "${q}".`);
    const lines = found.matches.map(m => `${m.path}:${m.line}  ${m.text}`);
    return text(`${lines.join("\n")}${found.truncated ? `\n(first ${found.matches.length} matches; narrow with path)` : ""}`);
  },

  async write_site_file(args = {}) {
    const siteId = siteOf(args);
    if (!args.path || typeof args.text !== "string") throw new Error("path and text are required.");
    const res = await putFile(siteId, args.path, args.text, args.baseVersion);
    return text(getContext().stageFileEdits ? whereNow(`${args.path} (version ${res.version})`) : whereNow(`Saved ${args.path} to the draft (version ${res.version}).`));
  },

  async edit_site_file(args = {}) {
    const siteId = siteOf(args);
    if (!args.path) throw new Error("path is required.");
    const edits = Array.isArray(args.edits) ? args.edits : [];
    if (!edits.length) throw new Error("edits is required: [{ oldText, newText }].");
    // Retry once when the file moved on between our read and our write and no base was pinned by the caller:
    // the replacements are re-applied to the fresh text, so an unrelated change isn't lost.
    for (let attempt = 0; ; attempt++) {
      const file = await readFile(siteId, args.path);
      if (args.baseVersion && args.baseVersion !== file.version) {
        throw new Error(`${args.path} changed since version ${args.baseVersion} (now ${file.version}). Nothing was saved. Read it again.`);
      }
      const next = applyEdits(String(file.text), edits, args.path);
      if (next === file.text) return text(`No change: ${args.path} already reads that way.`);
      try {
        const res = await apiFetch(filesUrl(siteId, args.path), { method: "PUT", body: { text: next, baseVersion: file.version } });
        markWritten();
        const done = `${args.path} (${edits.length} change${edits.length > 1 ? "s" : ""}; version ${res.version})`;
        return text(getContext().stageFileEdits ? whereNow(`Edit to ${done}`) : whereNow(`Edited ${done}.`));
      } catch (err) {
        if (err?.body?.error === "version_conflict" && !args.baseVersion && attempt === 0) continue;
        return explain(err, { path: args.path, sent: next });
      }
    }
  },

  async delete_site_file(args = {}) {
    const siteId = siteOf(args);
    if (!args.path) throw new Error("path is required.");
    const pages = (await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/source-pages`)).pages || [];
    const owner = pages.find(p => p.file === args.path);
    if (owner) throw new Error(`${args.path} is page ${owner.pageId} (${owner.url}). Use delete_page to remove a page.`);
    const file = await readFile(siteId, args.path);
    if (args.baseVersion && args.baseVersion !== file.version) {
      throw new Error(`${args.path} changed since version ${args.baseVersion}. Nothing was deleted. Read it again.`);
    }
    try {
      await apiFetch(filesUrl(siteId), {
        method: "POST",
        body: { changes: [{ path: args.path, delete: true }], baseVersions: { [args.path]: file.version } },
      });
    } catch (err) {
      return explain(err, { path: args.path });
    }
    markWritten();
    const note = "Any {% render %} of it now renders nothing; search_site_files for its name to fix those.";
    return text(getContext().stageFileEdits ? `${whereNow(`Deleting ${args.path}`)} ${note}` : `Deleted ${args.path} from the draft. ${note}`);
  },
};
