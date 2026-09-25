const { apiFetch } = require("../core/api-fetch");
const { getActiveTarget } = require("../helpers/index.js");

/**
 * Resolve the active site for Stripe tools. These only apply to sites
 * (not templates) — templates don't carry credentials.
 */
function requireActiveSite(args) {
  const target = getActiveTarget(args.siteId ? { id: args.siteId } : args);
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

/** Connect status for a site, or null when it has no Stripe connection yet. */
async function getConnectStatus(siteId) {
  try {
    return await apiFetch(`/api/stripe/connect/account?pageId=${encodeURIComponent(siteId)}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

module.exports = {
  /**
   * Connect Stripe to the active site. Creates the Connect account when the
   * site has none, then returns Stripe's hosted onboarding link — identity and
   * bank details can only be entered by the owner on Stripe, never by an agent.
   */
  async stripe_connect(args = {}) {
    const siteId = requireActiveSite(args);
    let status = await getConnectStatus(siteId);

    if (status?.mode === "raw_key") {
      return {
        content: [{ type: "text", text: `Site ${siteId} is connected to Stripe with an API key. Ready to take payments.` }],
        structuredContent: { status: "ready", mode: "raw_key" },
      };
    }

    if (!status) {
      await apiFetch("/api/stripe/connect/account", { method: "POST", body: { pageId: siteId } });
      status = { mode: "connect", readyToProcessPayments: false, onboardingComplete: false };
    }

    if (status.readyToProcessPayments && status.onboardingComplete) {
      return {
        content: [{ type: "text", text: `Stripe is connected on site ${siteId} and ready to take payments.` }],
        structuredContent: { status: "ready", mode: "connect", connectedAccountId: status.connectedAccountId },
      };
    }

    const { url } = await apiFetch("/api/stripe/connect/onboarding-link", {
      method: "POST",
      body: { pageId: siteId },
    });
    return {
      content: [
        {
          type: "text",
          text: [
            `Stripe setup for site ${siteId} needs the owner to finish on Stripe.`,
            `Give the user this link (single use, expires in a few minutes — call stripe_connect again for a fresh one):`,
            url,
            `After they finish, call stripe_connect again to confirm it's ready.`,
          ].join("\n"),
        },
      ],
      structuredContent: { status: "onboarding_required", mode: "connect", url },
    };
  },

  /**
   * Make a collection sellable (or stop selling it) through the site's Stripe
   * connection. Wraps `/api/v1/sites/:id/checkout`.
   */
  async set_checkout(args = {}) {
    const siteId = requireActiveSite(args);
    const slug = String(args.collection_slug || "").trim().toLowerCase();
    if (!slug) throw new Error("collection_slug is required.");
    const base = `/api/v1/sites/${encodeURIComponent(siteId)}/checkout`;

    if (args.remove) {
      await apiFetch(`${base}?collectionSlug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      return { content: [{ type: "text", text: `Checkout removed from collection "${slug}".` }] };
    }

    const fieldMap = {};
    if (args.price_id_field) fieldMap.priceId = args.price_id_field;
    if (args.price_field) fieldMap.price = args.price_field;
    if (args.inventory_field) fieldMap.inventory = args.inventory_field;
    if (args.variants_field) fieldMap.variants = args.variants_field;

    const { config } = await apiFetch(base, {
      method: "POST",
      body: { collectionSlug: slug, provider: "stripe", fieldMap },
    });
    const connect = await getConnectStatus(siteId);
    const ready =
      connect?.mode === "raw_key" || (connect?.readyToProcessPayments && connect?.onboardingComplete);
    return {
      content: [
        {
          type: "text",
          text: [
            `Checkout enabled on collection "${slug}" (${
              config.fieldMap?.priceId ? `charges Stripe price from "${config.fieldMap.priceId}"` : `charges the numeric "price" field`
            }). Add-to-cart buttons on rows of this collection now sell through Stripe.`,
            ready ? null : `Stripe isn't ready on this site yet — call stripe_connect before sending anyone to buy.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      structuredContent: { config, stripeReady: !!ready },
    };
  },

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
      throw new Error("id (Stripe product id) or slug is required.");
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
