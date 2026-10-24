/**
 * HTML site import — `import_site` + `get_import_status`, over the shared
 * import routes (`/api/import/presign`, `/api/import`, `/api/import/status`).
 *
 * Every mode ends in the same import job, which builds a NEW draft site:
 *   - `size`      → a 10-minute presigned PUT URL for the zip + its `uploadKey`
 *                   (the R2 key, already bound to the caller by the server).
 *   - `uploadKey` → starts the import of that uploaded zip.
 *   - `files`     → inline text files, zipped server-side (≤ 3 MB). The only
 *                   path for a client with no filesystem and no shell.
 *   - `filePath`  → local stdio server only (packages/mcp zips the folder and
 *                   runs the size → PUT → uploadKey steps itself).
 *   - `restOf`    → no upload: brings the pages a capped import left out into
 *                   that import's site (after the owner upgraded).
 * `pages` (archive paths) picks which pages fill the plan's page limit; the
 * home page is always one of them.
 *
 * Spec: docs/import/shell-and-html-build-plan.md (P5.2)
 */

const { apiFetch, normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getEditorUrl } = require("../helpers/target");

const MAX_WARNINGS = 10;

function text(t) {
  return { content: [{ type: "text", text: t }] };
}

/** The ready-to-run upload command for a presign response. */
function curlLine(uploadUrl, contentType) {
  return `curl -sS -X PUT -H "Content-Type: ${contentType}" --data-binary @site.zip "${uploadUrl}"`;
}

/**
 * Human/agent-readable summary of `GET /api/import/status`
 * (`ImportStatusResponse`, utils/importers/importTypes.ts). Shared by the
 * hosted `get_import_status` and the local stdio `import_site`.
 * @param {object} body - ImportStatusResponse (its `previewUrl` is the site's own preview link)
 */
function formatImportStatus(body) {
  const p = body.progress || {};
  const lines = [`Import ${body.importId}: ${body.status}${p.phase ? ` (${p.phase})` : ""}`];
  if (p.pagesTotal) lines.push(`Pages: ${p.pagesDone || 0}/${p.pagesTotal}`);
  if (p.mediaTotal) lines.push(`Media: ${p.mediaDone || 0}/${p.mediaTotal}`);

  const redirects = Array.isArray(body.result?.redirects) ? body.result.redirects : [];
  if (redirects.length) {
    lines.push(`Redirects from the old page addresses: ${redirects.length} (e.g. ${redirects[0].from} → ${redirects[0].to})`);
  }
  lines.push(...pageCapLines(body));
  const warnings = body.warnings || [];
  if (warnings.length) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const w of warnings.slice(0, MAX_WARNINGS)) lines.push(`  - ${w}`);
    if (warnings.length > MAX_WARNINGS) lines.push(`  …and ${warnings.length - MAX_WARNINGS} more`);
  }
  const skipped = body.skippedMedia || [];
  if (skipped.length) lines.push(`Files that couldn't be imported: ${skipped.length}`);

  if (body.status === "ready" && body.siteId) {
    lines.push(
      `Site: ${body.siteId}`,
      `Editor: ${getEditorUrl(body.siteId)}`,
      ...(body.previewUrl ? [`Preview: ${body.previewUrl}`] : []),
      "The site is a draft. Nothing is published."
    );
  } else if (body.status === "failed") {
    lines.push(`Error: ${body.error || "The import stopped without a reason."}`);
    if (body.siteId) {
      lines.push(
        `The empty draft site ${body.siteId} is still there — delete_site it, or run import_site again.`
      );
    }
  } else if (body.status === "review") {
    lines.push("Waiting for the page review in the dashboard.");
  } else {
    lines.push("Still running. Check again in about 5 seconds.");
  }
  return lines.join("\n");
}

/**
 * What the plan's page cap left out, and the agent's next step: which pages, how to pick others (a new import with
 * `pages`), and how to bring the rest into the same site after an upgrade (`import_site({ restOf })`).
 */
function pageCapLines(body) {
  const cap = body.leftOut || body.pageCap;
  if (!cap) return [];
  const left = cap.total - cap.kept;
  const lines = [
    `Page limit: ${cap.kept} of ${cap.total} pages imported (the plan's limit). The home page is always included.`,
  ];
  const plan = body.plan || {};
  const read = new Set((plan.pages || []).map(p => p.id));
  const out = (plan.allPages || []).map(p => p.path).filter(p => !read.has(p));
  if (out.length) {
    lines.push(`Left out: ${out.slice(0, 20).join(", ")}${out.length > 20 ? `, …and ${out.length - 20} more` : ""}`);
  }
  if (body.status !== "ready") return lines;
  if (body.leftOut?.canBring) {
    lines.push(
      `The plan now takes ${body.leftOut.maxPages} pages. To add the other ${left} to this same site, call import_site({ restOf: "${body.leftOut.importId}" }).`
    );
  } else if (body.leftOut) {
    lines.push(
      `To add the other ${left} to this same site, the owner upgrades at ${pricingUrl()}, then call import_site({ restOf: "${body.leftOut.importId}" }). ` +
        "To pick which pages fill the limit instead, start a new import with pages: [archive paths] (it makes a new site)."
    );
  }
  return lines;
}

function pricingUrl() {
  return `${normalizeBaseUrl(getContext().apiBaseUrl) || "https://pagehub.dev"}/pricing`;
}

/** Start an import from an uploaded key or inline files. `pages` picks which pages fill the plan's limit. */
async function startImport({ uploadKey, files, name, pages }) {
  return apiFetch("/api/import", {
    method: "POST",
    body: {
      source: "html",
      ...(uploadKey ? { fileKeys: [uploadKey] } : { inlineFiles: files }),
      options: { siteName: name, ...(Array.isArray(pages) && pages.length ? { pagePaths: pages } : {}) },
      autoConfirm: true,
    },
  });
}

/** Bring the pages a capped import left out into the same site. Returns `{ importId, siteId }`. */
async function startRestImport(restOf) {
  return apiFetch("/api/import", { method: "POST", body: { restOf } });
}

/** Presign a private upload for a zip of `size` bytes. */
async function presignImport(size) {
  return apiFetch("/api/import/presign", {
    method: "POST",
    body: { source: "html", filename: "site.zip", size },
  });
}

module.exports = {
  formatImportStatus,
  presignImport,
  startImport,
  startRestImport,

  /**
   * @param {object} args - exactly one of { filePath, size, uploadKey, files, restOf }, plus name?, pages?
   */
  async import_site(args = {}) {
    const modes = ["filePath", "size", "uploadKey", "files", "restOf"].filter(k => args[k] !== undefined && args[k] !== null);
    if (modes.length !== 1) throw new Error("Pass one of filePath, size, uploadKey, files or restOf.");

    if (args.restOf !== undefined) {
      const { importId, siteId } = await startRestImport(String(args.restOf));
      return text(
        `Bringing the rest of the pages into site ${siteId} (importId: ${importId}). ` +
          "The site's own pages, header, footer and theme stay as they are. Call get_import_status every ~5 s until it says ready."
      );
    }

    if (args.filePath !== undefined) {
      throw new Error(
        "filePath is only available in the local PageHub MCP server (stdio). " +
          "Here, zip the site and pass size (the zip's byte count) to get an upload URL, or send the files inline with files."
      );
    }

    if (args.size !== undefined) {
      if (!Number.isInteger(args.size) || args.size <= 0) {
        throw new Error("size must be the zip's exact byte count (wc -c < site.zip).");
      }
      const { key, uploadUrl, contentType } = await presignImport(args.size);
      return text(
        [
          `uploadKey: ${key}`,
          `Upload URL (valid 10 min): ${uploadUrl}`,
          `Required header: Content-Type: ${contentType}`,
          "",
          "Upload the zip from its folder:",
          curlLine(uploadUrl, contentType),
          "",
          `No output means it uploaded. An XML error means it didn't (a 403 usually means the file isn't exactly ${args.size} bytes).`,
          `Then call import_site({ uploadKey: "${key}" }).`,
        ].join("\n")
      );
    }

    if (args.files !== undefined && !Array.isArray(args.files)) {
      throw new Error("files must be an array of { path, content }.");
    }
    const { importId } = await startImport({
      uploadKey: args.uploadKey,
      files: args.files,
      name: args.name,
      pages: args.pages,
    });
    return text(
      `Import started (importId: ${importId}). It builds a new draft site. ` +
        "Call get_import_status every ~5 s until it says ready."
    );
  },

  /** @param {object} args - { importId } */
  async get_import_status(args = {}) {
    if (!args.importId) throw new Error("importId is required.");
    const body = await apiFetch(`/api/import/status?importId=${encodeURIComponent(args.importId)}`);
    return text(formatImportStatus(body));
  },
};
