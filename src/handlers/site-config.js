const fs = require("fs");
const path = require("path");
const { apiFetch } = require("../api-fetch");
const { fetchTarget, saveTarget, getActiveTarget } = require("../helpers/index.js");

const FAVICON_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const EXT_TO_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readLocalFavicon(filePath) {
  const resolved = path.resolve(String(filePath));
  let buf;
  try {
    buf = fs.readFileSync(resolved);
  } catch (e) {
    throw new Error(
      `Could not read filePath "${filePath}" (resolved: ${resolved}): ${e.code || e.message}. ` +
        `Pass an absolute path or a path relative to the MCP server's working directory.`
    );
  }
  const ext = path.extname(resolved).toLowerCase();
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) {
    throw new Error(
      `Unrecognized favicon extension "${ext}" for filePath "${filePath}". ` +
        `Supported: ${Object.keys(EXT_TO_MIME).join(", ")}.`
    );
  }
  return { dataBase64: buf.toString("base64"), mimeType, filename: path.basename(resolved) };
}

module.exports = {
  async set_integrations(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat.ROOT?.props) throw new Error("No ROOT node found.");
    const integrations = {};
    if (args.googleAnalytics)
      integrations.googleAnalytics = { measurementId: args.googleAnalytics };
    if (args.googleTagManager)
      integrations.googleTagManager = { containerId: args.googleTagManager };
    if (args.googleSearchConsole)
      integrations.googleSearchConsole = { verificationCode: args.googleSearchConsole };
    if (args.metaPixel) integrations.metaPixel = { pixelId: args.metaPixel };
    if (args.googleAds) integrations.googleAds = { conversionId: args.googleAds };
    flat.ROOT.props.integrations = { ...(flat.ROOT.props.integrations || {}), ...integrations };
    const result = await saveTarget(targetId, targetType, flat);
    const providers = Object.keys(integrations).join(", ") || "none";
    const label =
      targetType === "template"
        ? `Integrations updated in template "${targetId}": ${providers}.`
        : `Integrations updated: ${providers}.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
  },

  async set_favicon(args) {
    const target = getActiveTarget(args);
    if (target.type === "template") {
      throw new Error(
        "set_favicon is not supported for templates — favicons are per-site only."
      );
    }
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat.ROOT?.props) throw new Error("No ROOT node found.");

    if (args.clear) {
      if (flat.ROOT.props.seo?.favicon) {
        const { favicon, ...rest } = flat.ROOT.props.seo;
        flat.ROOT.props.seo = rest;
      }
      const result = await saveTarget(targetId, targetType, flat);
      return { content: [{ type: "text", text: `Favicon cleared.\nEditor: ${result.url}` }] };
    }

    const provided = ["mediaId", "imageUrl", "dataBase64", "svgContent", "filePath"].filter(
      k => args[k]
    );
    if (provided.length === 0) {
      throw new Error(
        "Provide one of: filePath (local file — easiest), mediaId, imageUrl, dataBase64, svgContent — or clear: true. Do NOT invent SVG markup."
      );
    }
    if (provided.length > 1) {
      throw new Error(`Provide only one source; got: ${provided.join(", ")}.`);
    }
    if (args.mimeType && !FAVICON_MIME.includes(args.mimeType)) {
      throw new Error(
        `Unsupported mimeType "${args.mimeType}". Allowed: ${FAVICON_MIME.join(", ")}`
      );
    }

    let favicon;
    let summary;
    let uploadFromFile = null;
    if (args.filePath) uploadFromFile = readLocalFavicon(args.filePath);

    if (args.svgContent) {
      const svg = String(args.svgContent).trim();
      if (!svg.startsWith("<svg") && !svg.startsWith("<?xml")) {
        throw new Error("svgContent must be raw SVG markup starting with <svg or <?xml.");
      }
      favicon = { type: "image/svg+xml", content: svg };
      summary = "inline SVG";
    } else if (args.mediaId) {
      favicon = { href: String(args.mediaId), type: "cdn" };
      summary = `mediaId ${args.mediaId}`;
    } else {
      const body = uploadFromFile
        ? {
            dataBase64: uploadFromFile.dataBase64,
            mimeType: uploadFromFile.mimeType,
            filename: args.filename || uploadFromFile.filename,
          }
        : {
            ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
            ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
            ...(args.mimeType ? { mimeType: args.mimeType } : {}),
            ...(args.filename ? { filename: args.filename } : { filename: "favicon" }),
          };
      const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/media`, {
        method: "POST",
        body,
      });
      favicon = { href: data.mediaId, type: "cdn" };
      summary = uploadFromFile
        ? `uploaded ${uploadFromFile.filename} → mediaId ${data.mediaId} (${data.url})`
        : `uploaded mediaId ${data.mediaId} (${data.url})`;
    }

    flat.ROOT.props.seo = { ...(flat.ROOT.props.seo || {}), favicon };
    const result = await saveTarget(targetId, targetType, flat);
    return {
      content: [
        {
          type: "text",
          text: `Favicon set: ${summary}.\nEditor: ${result.url}`,
        },
      ],
    };
  },

  async set_redirects(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat.ROOT?.props) throw new Error("No ROOT node found.");
    const redirects = (args.redirects || []).map(r => ({
      from: r.from,
      to: r.to,
      permanent: r.permanent !== false,
    }));
    flat.ROOT.props.redirects = redirects.length ? redirects : undefined;
    const result = await saveTarget(targetId, targetType, flat);
    const label =
      targetType === "template"
        ? `${redirects.length} redirect rule(s) saved in template "${targetId}".`
        : `${redirects.length} redirect rule(s) saved.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
  },
};
