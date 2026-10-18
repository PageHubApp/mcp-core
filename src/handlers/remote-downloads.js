/**
 * Hosted file downloads — wraps `/api/v1/sites/:id/downloads`.
 *
 * A download is a stable public link (`<site>/api/downloads/<id>`) that always
 * serves its current version. Files come from `upload_file({ filePath,
 * private: true })`; the local stdio server's `set_download` also takes a
 * `filePath` and does that upload itself.
 */

const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");

function activeSiteId(args) {
  const ctx = getContext();
  const id = args?.id || ctx.activeSite?.id;
  if (!id) throw new Error("Site id is required (none provided and no active site set).");
  return id;
}

function path(siteId) {
  return `/api/v1/sites/${encodeURIComponent(siteId)}/downloads`;
}

function fmtSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fmtDownload(d) {
  const versions = (d.versions || [])
    .map(
      v =>
        `    ${v.current ? "★" : "·"} ${v.label} — ${v.filename} (${fmtSize(v.size)}) [versionId: ${v.id}]`
    )
    .join("\n");
  const members = d.access?.members
    ? `\n  members only: ${d.access.plans?.length ? `plans ${d.access.plans.join(", ")}` : "any active plan"}` +
      `\n  as a members-only video: Video provider "url", videoId "/api/downloads/${d.id}?inline=1"`
    : "";
  return `• ${d.name} [downloadId: ${d.id}]\n  url: ${d.url}\n  downloads: ${d.downloadCount}${members}\n${versions}`;
}

const LINK_HINT =
  'Link to it from a Button or Link: action [{ "type": "link", "href": "<url>" }]. ' +
  "The url never changes — a new version replaces what it serves.";

/**
 * Publish a download, or add a version to an existing one, from an already
 * uploaded private file.
 * @param {object} args - { id?, downloadId?, name?, mediaId, filename, label?, notes?, currentVersionId?, access? }
 */
async function setDownload(args = {}) {
  const siteId = activeSiteId(args);
  const isEdit =
    args.downloadId && !args.mediaId && (args.currentVersionId || args.access !== undefined || args.name);
  if (!isEdit && !args.mediaId) {
    throw new Error(
      "mediaId is required — upload with upload_file({ filePath, private: true }) first, " +
        "or pass downloadId + currentVersionId / access / name to change an existing download."
    );
  }
  if (!args.downloadId && !args.name) throw new Error("name is required for a new download.");
  const data = await apiFetch(path(siteId), {
    method: "POST",
    body: {
      downloadId: args.downloadId,
      name: args.name,
      mediaId: args.mediaId,
      filename: args.filename,
      label: args.label,
      notes: args.notes,
      currentVersionId: args.currentVersionId,
      access: args.access,
    },
  });
  return {
    content: [{ type: "text", text: `${fmtDownload(data.download)}\n\n${LINK_HINT}` }],
  };
}

module.exports = {
  /**
   * List the site's downloads with their links, versions and download counts.
   * @param {object} args - { id? }
   */
  async list_downloads(args = {}) {
    const siteId = activeSiteId(args);
    const data = await apiFetch(path(siteId));
    const list = data.downloads || [];
    const tier = {
      none: "not included on this plan (Pro or higher)",
      files: "files (installers like .exe / .dmg need Agency)",
      executables: "files and installers",
    }[data.fileDownloads];
    const head = tier ? `Plan allows: ${tier}\n\n` : "";
    const text = list.length ? list.map(fmtDownload).join("\n\n") : "No downloads on this site.";
    return { content: [{ type: "text", text: head + text }] };
  },

  // The stdio server wraps this: with a filePath it uploads privately first,
  // then calls here with the resulting mediaId.
  async set_download(args = {}) {
    if (args.filePath) {
      throw new Error(
        "filePath is only available in the local PageHub MCP server (stdio). " +
          "Pass the mediaId of a private upload instead."
      );
    }
    return setDownload(args);
  },

  /**
   * Remove a whole download (its link stops working) or one old version.
   * @param {object} args - { id?, downloadId, versionId? }
   */
  async remove_download(args = {}) {
    const siteId = activeSiteId(args);
    if (!args.downloadId) throw new Error("downloadId is required.");
    const qs = new URLSearchParams({ downloadId: args.downloadId });
    if (args.versionId) qs.set("versionId", args.versionId);
    const data = await apiFetch(`${path(siteId)}?${qs}`, { method: "DELETE" });
    const what = args.versionId ? `Version ${args.versionId} removed.` : "Download removed; its link now answers 404.";
    const files = data.deletedFiles?.length ? ` Deleted ${data.deletedFiles.length} file(s) from storage.` : "";
    return { content: [{ type: "text", text: what + files }] };
  },
};
