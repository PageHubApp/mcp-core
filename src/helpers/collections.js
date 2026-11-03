/**
 * Collection tools take a slug; the v1 routes take the collection's id. Kept out of handlers/remote-collections.js
 * because every export of a handler file becomes a tool name.
 */

const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");

function activeSiteId(args) {
  const id = args?.id || getContext().activeSite?.id;
  if (!id) throw new Error("Site id is required (none provided and no active site set).");
  return id;
}

/** The collection with this slug on the site (from the list route), or a "not found" error naming the slugs there. */
async function collectionBySlug(siteId, slug) {
  if (!slug) throw new Error("slug is required.");
  const list = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/collections`);
  const cols = list.collections || [];
  const col = cols.find(c => c.slug === slug);
  if (!col) throw new Error(`Collection "${slug}" not found.${cols.length ? ` This site has: ${cols.map(c => c.slug).join(", ")}.` : ""}`);
  return col;
}

/** `/api/v1/sites/<id>/collections/<colId>` for the collection with this slug. */
async function collectionPath(args) {
  const siteId = activeSiteId(args);
  const col = await collectionBySlug(siteId, args.slug);
  return `/api/v1/sites/${encodeURIComponent(siteId)}/collections/${encodeURIComponent(col._id)}`;
}

module.exports = { activeSiteId, collectionBySlug, collectionPath };
