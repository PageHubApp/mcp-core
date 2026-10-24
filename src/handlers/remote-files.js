/**
 * File tools: list, read, search, outline, write, edit and delete the draft's HTML + Liquid files through
 * `/api/v1/sites/:id/files` (app repo: docs/features/html-first-ai-mcp.md). Every write goes through the server's one
 * write seam (lint, sanitize, version check, maintenance freeze). A site's JavaScript is kept; the in-app AI client
 * never writes any (`helpers/aiWriteGuard.js`).
 *
 * A file's version is its content hash. `edit_site_file` reads the file, applies exact-text replacements and writes
 * against the version it read, so an edit can never silently overwrite someone else's change to the same file.
 *
 * A write answers with what the server STORED when that differs from what was sent (it repairs nesting and may
 * reformat): the repairs and a short diff, so the agent's next `oldText` matches the stored text.
 */
const { createHash } = require("node:crypto");
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget } = require("../helpers/target");
const { applyEdits, lineCol } = require("../helpers/file-edits");
const { lineDiff } = require("../helpers/line-diff");
const { editNotesSummary } = require("../helpers/edit-notes");
const { stylingLine } = require("../helpers/site-status-lines");
const { formatOutline } = require("../helpers/outline-format");

const text = t => ({ content: [{ type: "text", text: t }] });

function siteOf(args) {
  const target = getActiveTarget(args);
  return target.id;
}

const filesUrl = (siteId, path) =>
  `/api/v1/sites/${encodeURIComponent(siteId)}/files${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`;

/** Files one bulk read may name (the server's cap) and the characters of file text one reply shows. */
const MAX_READ_PATHS = 40;
const MAX_READ_REPLY_CHARS = 100_000;
const PAGE_FILE = /^pages\/.+\.liquid$/;

/** Server refusals that carry a message written for the agent. */
const MESSAGE_ERRORS = new Set(["bad_query", "bad_request", "bad_path", "page_not_found"]);

/** Turn the files API's refusals into what the agent should do next. Rethrows anything else. */
function explain(err, { path, sent }) {
  const body = err?.body || {};
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
  // The seam refused the write for a reason that isn't lint (a locked element, a bad path, too large): say why.
  if (body.error === "rejected" && body.message) throw new Error(`${path || "The write"} was NOT saved: ${body.message}`);
  if (MESSAGE_ERRORS.has(body.error) && body.message) throw new Error(body.message);
  // The plan's page cap and the like: a message and a code, no error name.
  if (err?.status === 403 && body.code && body.error) throw new Error(`${path || "The write"} was NOT saved: ${body.error}`);
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

/** A write's reply plus the server's warn-only notes (`advisories`: e.g. DaisyUI classes on a site with DaisyUI off). */
const withAdvisories = (reply, res) => (Array.isArray(res?.advisories) && res.advisories.length ? `${reply}\n${res.advisories.join("\n")}` : reply);

const sha256 = s => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * What the server stored when it isn't what was sent. `sent` maps path → the text written, `versions` path → the version
 * the server answered (the stored text's hash), `repaired` is the server's list of nesting fixes. A file is compared by
 * hash, so any server-side change shows: repairs, sanitizing, formatting. Differing files are read back and diffed
 * (only the changed lines), so the next `oldText` can be copied from the stored text. "" when it stored exactly that.
 */
async function storedNote(siteId, { sent, versions, repaired }) {
  const notes = [];
  for (const r of repaired || []) {
    const fixes = (r.fixes || []).slice(0, 4).map(f => `line ${f.line}: ${f.message}`).join("; ");
    notes.push(`${r.path}: the server repaired the HTML nesting (${fixes}${(r.fixes || []).length > 4 ? "; …" : ""}).`);
  }
  for (const [path, body] of Object.entries(sent)) {
    if (!versions[path] || sha256(body) === versions[path]) continue;
    let stored;
    try {
      stored = await apiFetch(filesUrl(siteId, path));
    } catch {
      continue;
    }
    const diff = lineDiff(body, String(stored.text));
    if (diff) notes.push(`${path}: stored differently from what you sent. Use the stored text in your next oldText:\n${diff}`);
  }
  return notes.length ? `\n${notes.join("\n")}` : "";
}

const pagesNote = res =>
  (res?.pages || []).map(p => `\nCreated page "${p.name}" as ${p.pageId} at ${p.url} (file ${p.file}).`).join("");

async function readFile(siteId, path) {
  try {
    return await apiFetch(filesUrl(siteId, path));
  } catch (err) {
    if (err?.body?.error === "file_not_found") throw new Error(`${path} doesn't exist. list_site_files shows the files.`);
    return explain(err, { path });
  }
}

async function putFile(siteId, path, sent, baseVersion, page) {
  try {
    const res = await apiFetch(filesUrl(siteId, path), { method: "PUT", body: { text: sent, baseVersion: baseVersion || null, ...(page ? { page } : {}) } });
    markWritten();
    return res;
  } catch (err) {
    return explain(err, { path, sent });
  }
}

/** One file as the read tools show it: header, the (sliced) text in a fence, and the notes written in it. */
function renderFile(path, file, startLine, endLine) {
  const all = String(file.text).split("\n");
  const start = Math.max(1, Number(startLine) || 1);
  const end = Math.min(all.length, Number(endLine) || all.length);
  const ranged = start > 1 || end < all.length;
  const body = ranged ? all.slice(start - 1, end).join("\n") : file.text;
  const notes = editNotesSummary(body, start);
  return `${path} — version ${file.version}, ${all.length} lines${ranged ? `; showing lines ${start}–${end}` : ""}.\n\`\`\`liquid\n${body}\n\`\`\`${notes ? `\n${notes}` : ""}`;
}

/** `read_site_file({ paths })`: several files in one call, each with its own optional line range. */
async function readMany(siteId, args) {
  const asked = [...(args.path ? [{ path: args.path, startLine: args.startLine, endLine: args.endLine }] : []), ...args.paths.map(p => (typeof p === "string" ? { path: p } : p))];
  if (asked.some(a => !a?.path)) throw new Error("Each entry of paths needs a path, e.g. { path: 'pages/index.liquid', startLine?, endLine? }.");
  if (asked.length > MAX_READ_PATHS) throw new Error(`Read at most ${MAX_READ_PATHS} files per call.`);
  let res;
  try {
    res = await apiFetch(`${filesUrl(siteId)}?read=${encodeURIComponent(asked.map(a => a.path).join(","))}`);
  } catch (err) {
    return explain(err, { path: "" });
  }
  const byPath = new Map(res.files.map(f => [f.path, f]));
  const out = [];
  const held = [];
  let chars = 0;
  for (const a of asked) {
    const file = byPath.get(a.path);
    if (!file) continue;
    const shown = renderFile(a.path, file, a.startLine, a.endLine);
    if (chars + shown.length > MAX_READ_REPLY_CHARS && out.length) {
      held.push(`${a.path} (${file.text.length} chars)`);
      continue;
    }
    chars += shown.length;
    out.push(shown);
  }
  const notes = [];
  if (res.missing.length) notes.push(`Not in the draft: ${res.missing.join(", ")}. list_site_files shows the files.`);
  const left = [...held, ...res.skipped.map(s => `${s.path} (${s.chars} chars)`)];
  if (left.length) notes.push(`Not shown, too much for one reply: ${left.join(", ")}. Read them in a separate call, or with startLine / endLine.`);
  return text([...out, ...notes].join("\n\n"));
}

/** `path:line:column  window` hits, with `context` lines under each when asked. */
function formatMatches(found, q, args) {
  if (!found.matches.length) return `No file contains ${args.regex ? "a match for /" : '"'}${q}${args.regex ? "/" : '"'}${args.glob ? ` in ${args.glob}` : ""}.`;
  const lines = found.matches.flatMap(m => {
    const head = `${m.path}:${m.line}:${m.column}  ${m.text}`;
    if (!m.before && !m.after) return [head];
    const ctx = (rows, from) => (rows || []).map((t, i) => `    ${from + i} | ${t}`);
    return [head, ...ctx(m.before, m.line - (m.before || []).length), ...ctx(m.after, m.line + 1)];
  });
  const more = found.truncated ? `\n(first ${found.matches.length} matches; narrow with path or glob)` : "";
  return `${lines.join("\n")}${more}`;
}

module.exports = {
  async list_site_files(args = {}) {
    const siteId = siteOf(args);
    let listed;
    try {
      listed = await apiFetch(`${filesUrl(siteId)}${args.glob ? `?glob=${encodeURIComponent(String(args.glob))}` : ""}`);
    } catch (err) {
      return explain(err, { path: "" });
    }
    const pages = (await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/source-pages`)).pages || [];
    const byFile = new Map(pages.filter(p => p.file).map(p => [p.file, p]));
    const lines = listed.paths.map(p => {
      const page = byFile.get(p);
      return `${p}${page ? `  → page ${page.pageId} at ${page.url}${page.isHomePage ? " (home)" : ""}` : ""}`;
    });
    const styling = stylingLine(listed);
    const head = args.glob ? `Files of site ${siteId} matching ${args.glob} (draft version ${listed.version})` : `Files of site ${siteId} (draft version ${listed.version})`;
    return text(
      `${head}:\n${lines.join("\n") || "(none)"}\n\n${styling ? `${styling}\n` : ""}read_site_file to read one; edit_site_file to change it. Format rules: get_style_reference({ topic: "liquid" }).`
    );
  },

  async read_site_file(args = {}) {
    const siteId = siteOf(args);
    if (Array.isArray(args.paths) && args.paths.length) return readMany(siteId, args);
    if (!args.path) throw new Error("path is required, e.g. pages/index.liquid (list_site_files shows them); paths reads several at once.");
    const file = await readFile(siteId, args.path);
    return text(renderFile(args.path, file, args.startLine, args.endLine));
  },

  async search_site_files(args = {}) {
    const siteId = siteOf(args);
    const q = String(args.query || "");
    if (!q.trim()) throw new Error("query is required.");
    const params = new URLSearchParams({
      q,
      ...(args.regex ? { regex: "1" } : {}),
      ...(args.glob ? { glob: String(args.glob) } : {}),
      ...(args.context ? { context: String(Math.floor(Number(args.context)) || 0) } : {}),
      ...(args.path ? { path: String(args.path) } : {}),
    });
    let found;
    try {
      found = await apiFetch(`${filesUrl(siteId)}?${params}`);
    } catch (err) {
      return explain(err, { path: "" });
    }
    return text(formatMatches(found, q, args));
  },

  /** The structure of a page: sections, headings, and every rendered partial expanded in place, with line anchors. */
  async outline_page(args = {}) {
    const siteId = siteOf(args);
    if (!args.page) throw new Error("page is required: a page id (list_pages), its URL like /about, or a file path.");
    const params = new URLSearchParams({ page: String(args.page), ...(args.expand === false ? { expand: "0" } : {}), ...(args.classes ? { classes: "1" } : {}) });
    let res;
    try {
      res = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/outline?${params}`);
    } catch (err) {
      return explain(err, { path: "" });
    }
    return text(formatOutline(res));
  },

  async write_site_file(args = {}) {
    const siteId = siteOf(args);
    if (!args.path || typeof args.text !== "string") throw new Error("path and text are required.");
    // A new pages/<slug>.liquid also gets its page record (like add_page), so the page exists and is reachable.
    const page = PAGE_FILE.test(args.path) && !args.baseVersion ? {} : undefined;
    const res = await putFile(siteId, args.path, args.text, args.baseVersion, page);
    const staged = getContext().stageFileEdits;
    const done = staged ? whereNow(`${args.path} (version ${res.version})`) : whereNow(`Saved ${args.path} to the draft (version ${res.version}).`);
    const stored = await storedNote(siteId, { sent: { [args.path]: args.text }, versions: { [args.path]: res.version }, repaired: res.repaired });
    return text(withAdvisories(`${done}${pagesNote(res)}${stored}`, res));
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
        const reply = getContext().stageFileEdits ? whereNow(`Edit to ${done}`) : whereNow(`Edited ${done}.`);
        const stored = await storedNote(siteId, { sent: { [args.path]: next }, versions: { [args.path]: res.version }, repaired: res.repaired });
        return text(withAdvisories(`${reply}${stored}`, res));
      } catch (err) {
        if (err?.body?.error === "version_conflict" && !args.baseVersion && attempt === 0) continue;
        return explain(err, { path: args.path, sent: next });
      }
    }
  },

  /**
   * Several files edited as ONE atomic write: every file's edits are applied to the text just read and the batch is
   * saved against those versions, so either all land or none do (the multi-file `patch_site_bulk`). An entry with `text`
   * instead of `edits` creates a new file, and a new `pages/<slug>.liquid` also gets its page record, so "add a page plus
   * a nav link" is one call.
   */
  async edit_site_files(args = {}) {
    const siteId = siteOf(args);
    const files = Array.isArray(args.files) ? args.files : [];
    if (!files.length) throw new Error("files is required: [{ path, edits: [{ oldText, newText }] }].");
    const paths = files.map(f => f?.path);
    if (paths.some(x => !x) || new Set(paths).size !== paths.length) throw new Error("Each entry needs its own path (no path twice).");
    for (let attempt = 0; ; attempt++) {
      const changes = [];
      const baseVersions = {};
      const pages = [];
      for (const f of files) {
        if (typeof f.text === "string") {
          if (f.edits) throw new Error(`${f.path}: send text (a new file) or edits (changes to an existing one), not both.`);
          changes.push({ path: f.path, text: f.text });
          baseVersions[f.path] = null;
          if (PAGE_FILE.test(f.path)) pages.push({ path: f.path, ...(f.name ? { name: f.name } : {}), ...(f.seo ? { seo: f.seo } : {}) });
          continue;
        }
        const edits = Array.isArray(f.edits) ? f.edits : [];
        if (!edits.length) throw new Error(`${f.path}: edits is required: [{ oldText, newText }] (or text, to create a new file).`);
        const file = await readFile(siteId, f.path);
        if (f.baseVersion && f.baseVersion !== file.version) {
          throw new Error(`${f.path} changed since version ${f.baseVersion} (now ${file.version}). Nothing was saved. Read it again.`);
        }
        const next = applyEdits(String(file.text), edits, f.path);
        if (next !== file.text) {
          changes.push({ path: f.path, text: next });
          baseVersions[f.path] = file.version;
        }
      }
      if (!changes.length) return text("No change: every file already reads that way.");
      try {
        const res = await apiFetch(filesUrl(siteId), { method: "POST", body: { changes, baseVersions, ...(pages.length ? { pages } : {}) } });
        markWritten();
        const done = `${changes.length} file${changes.length > 1 ? "s" : ""} (${changes.map(c => c.path).join(", ")})`;
        const reply = getContext().stageFileEdits ? whereNow(`Edit to ${done}`) : whereNow(`Edited ${done} in one write.`);
        const stored = await storedNote(siteId, { sent: Object.fromEntries(changes.map(c => [c.path, c.text])), versions: res.versions || {}, repaired: res.repaired });
        return text(withAdvisories(`${reply}${pagesNote(res)}${stored}`, res));
      } catch (err) {
        if (err?.body?.error === "version_conflict" && !files.some(f => f.baseVersion) && attempt === 0) continue;
        return explain(err, { path: paths.join(", ") });
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
