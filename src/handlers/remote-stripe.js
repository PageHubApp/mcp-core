const { apiFetch } = require("../api-fetch");
const { getActiveTarget } = require("../helpers");

/**
 * Resolve the active site for Stripe tools. These only apply to sites
 * (not templates) — templates don't carry credentials.
 */
function requireActiveSite(args) {
  const target = getActiveTarget(args);
  if (target.type !== "site") {
    throw new Error(
      "Stripe tools operate on a site. Select a site first with select_site or pass siteId."
    );
  }
  return target.id;
}

function formatItem(item) {
  const parts = [`• ${item.id} — ${item.title}`];
  if (item.price?.formatted) parts.push(item.price.formatted);
  if (item.metadata?.category) parts.push(`#${item.metadata.category}`);
  return parts.join("  ");
}

module.exports = {
  async stripe_search_products(args = {}) {
    const siteId = requireActiveSite(args);
    const qs = new URLSearchParams({ action: "search" });
    if (args.query) qs.set("q", args.query);
    if (args.category) qs.set("category", args.category);
    if (args.limit) qs.set("limit", String(args.limit));
    if (args.sort) qs.set("sort", args.sort);
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/stripe?${qs.toString()}`
    );
    const items = data.items || [];
    const lines = items.length ? items.slice(0, 50).map(formatItem) : ["No products matched."];
    return {
      content: [
        {
          type: "text",
          text: [
            `Found ${items.length} product(s) on site ${siteId}${args.query ? ` matching "${args.query}"` : ""}:`,
            ...lines,
          ].join("\n"),
        },
      ],
      structuredContent: { items },
    };
  },

  async stripe_list_categories(args = {}) {
    const siteId = requireActiveSite(args);
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/stripe?action=categories`
    );
    const items = data.items || [];
    const lines = items.length
      ? items.map(c => `• ${c.slug} — ${c.metadata?.count || 0} product(s)`)
      : ["No categories found. Set metadata.category on products in Stripe."];
    return {
      content: [
        {
          type: "text",
          text: [`Categories on site ${siteId}:`, ...lines].join("\n"),
        },
      ],
      structuredContent: { items },
    };
  },

  async stripe_get_product(args = {}) {
    const siteId = requireActiveSite(args);
    if (!args.id && !args.slug) {
      throw new Error("Pass either id (Stripe product id) or slug.");
    }
    const qs = new URLSearchParams({ action: "product" });
    if (args.id) qs.set("id", args.id);
    if (args.slug) qs.set("slug", args.slug);
    const data = await apiFetch(
      `/api/v1/sites/${encodeURIComponent(siteId)}/stripe?${qs.toString()}`
    );
    if (!data.item) {
      return {
        content: [{ type: "text", text: `No product found.` }],
        structuredContent: { item: null },
      };
    }
    const item = data.item;
    return {
      content: [
        {
          type: "text",
          text: [
            `Product ${item.id}`,
            `  Title: ${item.title}`,
            `  Slug: ${item.slug || "(none)"}`,
            `  Price: ${item.price?.formatted || "(unset)"}`,
            item.priceRange ? `  Range: ${item.priceRange.formatted}` : null,
            item.description ? `  Description: ${item.description.slice(0, 200)}` : null,
            item.metadata?.category ? `  Category: ${item.metadata.category}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      structuredContent: { item },
    };
  },
};
