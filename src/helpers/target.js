const { normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");

/**
 * Resolve the site a tool call works on.
 * Priority: explicit `id` arg > the context's active site (stateful stdio / in-app agent).
 * Returns { type: 'site', id }.
 */
function getActiveTarget(args = {}) {
  const ctx = getContext();
  // An explicit id wins. The AI client is pinned to the chat's site: an id the
  // model picked up from history or pasted text must not reach another site
  // the user is also a member of (its draft would then be saved into this one).
  if (args.id) {
    if (ctx.client === "ai" && ctx.activeSite?.id && args.id !== ctx.activeSite.id) {
      throw new Error(
        `This chat works on site ${ctx.activeSite.id}; it can't touch ${args.id}. Switch to that site in the dashboard first.`
      );
    }
    return { type: "site", id: args.id };
  }
  if (ctx.activeSite) return { type: "site", id: ctx.activeSite.id };
  if (ctx.stateless) {
    throw new Error(
      "No site given. Pass the site `id` on this call — this server doesn't remember select_site between calls."
    );
  }
  throw new Error("No site selected. Run select_site first.");
}

/**
 * Trailer for tools that set the active site. On a stateless server
 * (`ctx.stateless`, the hosted HTTP endpoint) the selection only lasts for the
 * call that made it, so the agent has to carry the id itself.
 * @param {{ type: 'site', id: string }} target
 */
function selectionNote(target) {
  if (!getContext().stateless) return "";
  return `\nPass id: "${target.id}" on every later call — this server doesn't remember the selection between calls.`;
}

/** The active site's id. */
function getActiveSiteId(args) {
  return getActiveTarget(args).id;
}

function getEditorUrl(siteId) {
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
  return `${base}/dashboard/sites/${siteId}/design`;
}

module.exports = {
  getActiveTarget,
  selectionNote,
  getActiveSiteId,
  getEditorUrl,
};
