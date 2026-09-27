/**
 * Site-level configuration tools — analytics integrations, favicons,
 * redirect rules. All operate on `ROOT.props.*` of the active site/template
 * (favicon uploads also call the `/sites/:id/media` endpoint).
 */

const { apiFetch } = require("../core/api-fetch");
const { ROOT_NODE_ID } = require("../core/constants");

const { fetchTarget, saveTarget, getActiveTarget } = require("../helpers/index.js");

const FAVICON_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

module.exports = {
  /**
   * Set analytics / pixel / GSC integration IDs on `ROOT.props.integrations`.
   * @param {object} args - { googleAnalytics?, googleTagManager?, googleSearchConsole?, metaPixel?, googleAds? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_integrations(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat[ROOT_NODE_ID]?.props) throw new Error("ROOT node not found.");
    const integrations = {};
    if (args.googleAnalytics)
      integrations.googleAnalytics = { measurementId: args.googleAnalytics };
    if (args.googleTagManager)
      integrations.googleTagManager = { containerId: args.googleTagManager };
    if (args.googleSearchConsole)
      integrations.googleSearchConsole = { verificationCode: args.googleSearchConsole };
    if (args.metaPixel) integrations.metaPixel = { pixelId: args.metaPixel };
    if (args.googleAds) integrations.googleAds = { conversionId: args.googleAds };
    flat[ROOT_NODE_ID].props.integrations = {
      ...(flat[ROOT_NODE_ID].props.integrations || {}),
      ...integrations,
    };
    const result = await saveTarget(targetId, targetType, flat);
    const providers = Object.keys(integrations).join(", ") || "none";
    const label =
      targetType === "template"
        ? `Integrations updated in template "${targetId}": ${providers}.`
        : `Integrations updated: ${providers}.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
  },

  /**
   * Set or clear the site favicon (accepts mediaId / imageUrl / dataBase64 /
   * svgContent, or `clear: true`).
   *
   * `filePath` is handled one layer up, in the stdio server: a local file is a
   * normal image upload (signed direct upload, sharp prep) whose mediaId lands
   * here. Reading it in core would mean reading PageHub's own disk on the
   * hosted agent, and pushing the bytes through `dataBase64` would put them
   * under the 4.5 MB serverless body cap for no reason.
   *
   * @param {object} args - { mediaId?, imageUrl?, dataBase64?, svgContent?, mimeType?, filename?, clear? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_favicon(args) {
    const target = getActiveTarget(args);
    if (target.type === "template") {
      throw new Error("set_favicon is not supported for templates — favicons are per-site only.");
    }
    if (args.filePath) {
      throw new Error(
        "filePath is only available in the local PageHub MCP server (stdio). " +
          "In the hosted agent, pass imageUrl (a public http(s) URL), mediaId, or dataBase64 instead."
      );
    }
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat[ROOT_NODE_ID]?.props) throw new Error("ROOT node not found.");

    if (args.clear) {
      if (flat[ROOT_NODE_ID].props.seo?.favicon) {
        const { favicon, ...rest } = flat[ROOT_NODE_ID].props.seo;
        flat[ROOT_NODE_ID].props.seo = rest;
      }
      const result = await saveTarget(targetId, targetType, flat);
      return { content: [{ type: "text", text: `Favicon cleared.\nEditor: ${result.url}` }] };
    }

    const provided = ["mediaId", "imageUrl", "dataBase64", "svgContent"].filter(k => args[k]);
    if (provided.length === 0) {
      throw new Error(
        "A favicon source is required. Provide one of: filePath (local file — easiest), mediaId, imageUrl, dataBase64, svgContent — or `clear: true`. Do NOT invent SVG markup."
      );
    }
    if (provided.length > 1) {
      throw new Error(`Provide only one source; got: ${provided.join(", ")}.`);
    }
    if (args.mimeType && !FAVICON_MIME.includes(args.mimeType)) {
      throw new Error(
        `Unsupported mimeType "${args.mimeType}". Allowed: ${FAVICON_MIME.join(", ")}.`
      );
    }

    let favicon;
    let summary;

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
      const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/media`, {
        method: "POST",
        body: {
          ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
          ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
          ...(args.mimeType ? { mimeType: args.mimeType } : {}),
          ...(args.filename ? { filename: args.filename } : { filename: "favicon" }),
        },
      });
      favicon = { href: data.mediaId, type: "cdn" };
      summary = `uploaded mediaId ${data.mediaId} (${data.url})`;
    }

    flat[ROOT_NODE_ID].props.seo = { ...(flat[ROOT_NODE_ID].props.seo || {}), favicon };
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

  /**
   * Replace a site's redirect rules. For SITES these live in the page-scoped
   * `SiteRedirect` model (canon §N — one redirects home, off `ROOT.props`), written
   * via the redirects plugin's bulk endpoint. For TEMPLATES (starters with no model
   * home) they stay on `ROOT.props.redirects`.
   * @param {object} args - { redirects: Array<{from, to, permanent?}> }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_redirects(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);
    const redirects = (args.redirects || []).map(r => ({
      from: r.from,
      to: r.to,
      permanent: r.permanent !== false,
    }));

    if (targetType === "template") {
      if (!flat[ROOT_NODE_ID]?.props) throw new Error("ROOT node not found.");
      flat[ROOT_NODE_ID].props.redirects = redirects.length ? redirects : undefined;
      await saveTarget(targetId, targetType, flat);
      return {
        content: [
          { type: "text", text: `${redirects.length} redirect rule(s) saved in template "${targetId}".` },
        ],
      };
    }

    // Sites: write the SiteRedirect model via the plugin's bulk-replace endpoint.
    await apiFetch(`/api/plugins/redirects/rules/replace`, {
      method: "POST",
      body: { site: targetId, rules: redirects },
    });
    return {
      content: [{ type: "text", text: `${redirects.length} redirect rule(s) saved.` }],
    };
  },
};
