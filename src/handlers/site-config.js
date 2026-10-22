/**
 * Site-level configuration tools: analytics integrations, the favicon (written through html-settings.js into the
 * site's files and app models) and redirect rules (the page-scoped `SiteRedirect` model, written through the
 * redirects plugin's bulk endpoint).
 */

const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/target");
const htmlSettings = require("./html-settings");

module.exports = {
  set_integrations: htmlSettings.setIntegrations,
  set_favicon: htmlSettings.setFavicon,

  /**
   * Replace a site's redirect rules.
   * @param {object} args - { redirects: Array<{from, to, permanent?}> }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_redirects(args) {
    const redirects = (args.redirects || []).map(r => ({
      from: r.from,
      to: r.to,
      permanent: r.permanent !== false,
    }));
    const target = getActiveTarget(args);
    await apiFetch(`/api/plugins/redirects/rules/replace`, {
      method: "POST",
      body: { site: target.id, rules: redirects },
    });
    return { content: [{ type: "text", text: `${redirects.length} redirect rule(s) saved.` }] };
  },
};
