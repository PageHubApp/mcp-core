const { apiFetch } = require('../api-fetch');
const { getActiveTarget } = require('../helpers');

function requireSiteTarget(args) {
  const target = getActiveTarget(args);
  if (target.type === 'template') throw new Error('Portal operations are only available for sites, not templates.');
  return target.id;
}

module.exports = {
  async set_portal(args) {
    const siteId = requireSiteTarget(args);
    const portalObj = {
      enabled: true,
      type: args.type,
      status: args.status || 'unclaimed',
      ...(args.config || {}),
    };

    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
      method: 'PUT',
      body: { portal: portalObj },
    });

    return {
      content: [{
        type: 'text',
        text: `Portal "${args.type}" enabled on site ${data.id}.\n${JSON.stringify(data.portal, null, 2)}`,
      }],
    };
  },

  async get_portal(args) {
    const siteId = requireSiteTarget(args);
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`);

    if (!data.portal) {
      return { content: [{ type: 'text', text: `No portal configured on site ${siteId}.` }] };
    }

    return {
      content: [{
        type: 'text',
        text: `Portal config for site ${siteId}:\n${JSON.stringify(data.portal, null, 2)}`,
      }],
    };
  },

  async remove_portal(args) {
    const siteId = requireSiteTarget(args);
    await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
      method: 'PUT',
      body: { portal: null },
    });
    return { content: [{ type: 'text', text: `Portal removed from site ${siteId}.` }] };
  },
};
