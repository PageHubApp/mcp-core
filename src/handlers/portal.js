/**
 * Site portal CRUD tools (`set_portal` / `get_portal` / `remove_portal`).
 * Portals are site-only configuration blobs that drive embeddable portal
 * surfaces (auth, claim, billing).
 */

const { apiFetch } = require("../core/api-fetch");

const { getActiveTarget } = require("../helpers/index.js");

function requireSiteTarget(args) {
  const target = getActiveTarget(args);
  if (target.type === "template")
    throw new Error("Portal operations are only available for sites, not templates.");
  return target.id;
}

module.exports = {
  /**
   * Enable + configure a portal on the active site.
   * @param {object} args - { type, status?, config? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async set_portal(args) {
    const siteId = requireSiteTarget(args);
    const portalObj = {
      enabled: true,
      type: args.type,
      status: args.status || "unclaimed",
      ...(args.config || {}),
    };

    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
      method: "PUT",
      body: { portal: portalObj },
    });

    return {
      content: [
        {
          type: "text",
          text: `Portal "${args.type}" enabled on site ${data.id}.\n${JSON.stringify(data.portal, null, 2)}`,
        },
      ],
    };
  },

  /**
   * Read the portal configuration on the active site.
   * @param {object} args - { siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async get_portal(args) {
    const siteId = requireSiteTarget(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);

    if (!data.portal) {
      return { content: [{ type: "text", text: `No portal configured on site ${siteId}.` }] };
    }

    return {
      content: [
        {
          type: "text",
          text: `Portal config for site ${siteId}:\n${JSON.stringify(data.portal, null, 2)}`,
        },
      ],
    };
  },

  /**
   * Remove the portal configuration from the active site.
   * @param {object} args - { siteId? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
   */
  async remove_portal(args) {
    const siteId = requireSiteTarget(args);
    await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
      method: "PUT",
      body: { portal: null },
    });
    return { content: [{ type: "text", text: `Portal removed from site ${siteId}.` }] };
  },
};
