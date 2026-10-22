/**
 * Is the site this call targets an HTML-first site? Tools that don't read the node tree themselves (the block
 * library, templates) can't learn it from `fetchTarget`'s `SITE_IS_HTML`, so they ask here first.
 *
 * One cheap request per site per call context: the pages route answers 200 for an HTML-first site and 409
 * `site_format_changed` for a Craft one. Anything else (no access, no such site, offline) reads as "not HTML" and
 * the Craft path then reports its own error.
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget } = require("./target");

/**
 * @param {object} args  The tool's arguments. `id` names the site; a block / template `slug` is never read as a target.
 * @returns {Promise<{ html: boolean, siteId: string | null }>}
 */
async function resolveSiteFormat(args = {}) {
  let target;
  try {
    const { slug: _slug, ...rest } = args;
    target = getActiveTarget(rest);
  } catch {
    return { html: false, siteId: null };
  }
  if (target.type !== "site") return { html: false, siteId: null };

  const ctx = getContext();
  const cache = (ctx._siteFormats = ctx._siteFormats || new Map());
  if (cache.has(target.id)) return { html: cache.get(target.id), siteId: target.id };
  let html = false;
  try {
    await apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/source-pages`);
    html = true;
  } catch (err) {
    if (err?.status !== 409 && err?.status !== 404 && err?.status !== 403 && err?.status !== 401) throw err;
  }
  cache.set(target.id, html);
  return { html, siteId: target.id };
}

module.exports = { resolveSiteFormat };
