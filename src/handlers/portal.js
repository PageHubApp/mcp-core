const { apiFetch } = require('../api-fetch');
const { getContext } = require('../context');

function getActiveSiteId(args) {
  const ctx = getContext();
  const id = args.id || ctx.activeSite?.id;
  if (!id) throw new Error('No site id and no active site.');
  return id;
}

module.exports = {
  async set_portal(args) {
    const siteId = getActiveSiteId(args);
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
    const siteId = getActiveSiteId(args);
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
    const siteId = getActiveSiteId(args);
    await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}`, {
      method: 'PUT',
      body: { portal: null },
    });
    return { content: [{ type: 'text', text: `Portal removed from site ${siteId}.` }] };
  },
};
