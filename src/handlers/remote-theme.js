const { apiFetch } = require("../core/api-fetch");

const { parseMaybeJson, getActiveTarget } = require("../helpers/index.js");
const { formatUploadResult } = require("../helpers/upload-format");
const { validatePaletteContrast } = require("../utils/color-utils");
const htmlSettings = require("./html-settings");

function designPickerOptionsResult(kind, args) {
  const options = parseMaybeJson(args.options) || [];
  return {
    content: [{ type: "text", text: `Generated ${options.length} ${kind}.` }],
    paletteOptions: options,
  };
}

/**
 * Append contrast warnings (Primary ≈ Base Content / Base 100) to a
 * suggest_palettes result so the AI sees the issue in its tool output and can
 * re-roll with shifted lightness/hue. Pure additive — the editor still receives
 * `paletteOptions` unchanged, so the user can still pick a flagged palette
 * if they want; the warning is for the agent, not a hard block.
 */
function annotatePaletteWarnings(result, options) {
  const warnLines = [];
  for (const opt of options) {
    if (!opt || !Array.isArray(opt.palette)) continue;
    const issues = validatePaletteContrast(opt.palette);
    if (issues.length) {
      const label = opt.name || "(unnamed)";
      warnLines.push(`  • "${label}":`);
      for (const w of issues) warnLines.push(`      - ${w}`);
    }
  }
  if (warnLines.length) {
    const head = result.content?.[0];
    head.text += `\n\nContrast warnings:\n${warnLines.join("\n")}`;
  }
  return result;
}

const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/**
 * Shared upload path for `upload_image` (image-only) and `upload_file` (any
 * plan-allowed type). POSTs to `/api/v1/sites/:id/media`, which routes images
 * to Cloudflare Images (`type: "cdn"`) and everything else to R2 (`type: "r2"`).
 * @param {object} args - { fileUrl?|imageUrl?, dataBase64?, mimeType?, filename?, id? }
 * @param {{restrictToImages: boolean}} opts
 * @returns {Promise<{mediaId:string, type:string, url:string, contentType?:string}>}
 */
async function uploadMediaToSite(args, { restrictToImages }) {
  const target = getActiveTarget(args);
  if (target.type === "template") {
    throw new Error(
      `${
        restrictToImages ? "upload_image" : "upload_file"
      } is not supported for templates. Use a public URL in the template files instead.`
    );
  }
  // `filePath` reads the caller's own disk, so it only exists in the local
  // stdio MCP server. Here — the hosted agent — "the disk" is PageHub's
  // server, which the caller has no business reading from.
  if (args.filePath) {
    throw new Error(
      "filePath is only available in the local PageHub MCP server (stdio). " +
        "In the hosted agent, pass fileUrl (a public http(s) URL) or dataBase64 instead."
    );
  }
  // Private files go up only by signed direct upload, which needs filePath.
  // Without this the fileUrl / dataBase64 path would store them publicly.
  if (args.private === true) {
    throw new Error(
      "private uploads need filePath, which only the local PageHub MCP server (stdio) supports."
    );
  }
  const srcUrl = args.fileUrl || args.imageUrl;
  if (!srcUrl && !args.dataBase64) {
    throw new Error("fileUrl or dataBase64 is required.");
  }
  if (restrictToImages && args.mimeType && !ALLOWED_IMAGE_MIME.includes(args.mimeType)) {
    throw new Error(
      `Unsupported mimeType "${args.mimeType}". Allowed: ${ALLOWED_IMAGE_MIME.join(", ")}.`
    );
  }
  // A bare base64 blob (no data-URL prefix) carries no type — the server would
  // default it to image/jpeg. Require mimeType so non-image uploads route to R2.
  if (!restrictToImages && args.dataBase64 && !args.mimeType) {
    const hasDataUrlMime = /^data:[\w.+-]+\/[\w.+-]+;base64,/.test(String(args.dataBase64));
    if (!hasDataUrlMime) {
      throw new Error(
        "mimeType is required with dataBase64 for non-image uploads (e.g. video/mp4, application/pdf)."
      );
    }
  }
  const body = {
    ...(srcUrl ? { fileUrl: srcUrl } : {}),
    ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
    ...(args.mimeType ? { mimeType: args.mimeType } : {}),
    ...(args.filename ? { filename: args.filename } : {}),
  };
  return apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/media`, {
    method: "POST",
    body,
  });
}

module.exports = {
  async suggest_palettes(args) {
    const options = parseMaybeJson(args.options) || [];
    const result = designPickerOptionsResult("palette options", args);
    return annotatePaletteWarnings(result, options);
  },

  /** Font-only design picker — same client pipeline as suggest_palettes (`paletteOptions`). */
  async suggest_font_pairings(args) {
    return designPickerOptionsResult("font pairing options", args);
  },

  async upload_image(args) {
    const data = await uploadMediaToSite(args, { restrictToImages: true });
    return { content: [{ type: "text", text: formatUploadResult(data) }] };
  },

  async upload_file(args) {
    const data = await uploadMediaToSite(args, { restrictToImages: false });
    return { content: [{ type: "text", text: formatUploadResult(data) }] };
  },

  /** The theme is the site's theme.css (handlers/html-settings.js). */
  set_theme: htmlSettings.setTheme,
};
