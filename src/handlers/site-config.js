const { fetchTarget, saveTarget } = require("../helpers/index.js");

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
    flat.ROOT.props.integrations = { ...(flat.ROOT.props.integrations || {}), ...integrations };
    const result = await saveTarget(targetId, targetType, flat);
    const providers = Object.keys(integrations).join(", ") || "none";
    const label =
      targetType === "template"
        ? `Integrations updated in template "${targetId}": ${providers}.`
        : `Integrations updated: ${providers}.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
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
