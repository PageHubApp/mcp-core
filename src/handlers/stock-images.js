const { apiFetch } = require("../api-fetch");
const { IMAGE_PROVIDER_NAMES } = require("../../../../utils/stockProviders/types");

module.exports = {
  /**
   * Search for stock photos. Returns verified, working image URLs.
   * Searches local image bank first, falls back to external providers.
   */
  async find_image(args) {
    const { q, category, orientation, provider: rawProvider, count: rawCount } = args;
    const provider =
      typeof rawProvider === "string" && IMAGE_PROVIDER_NAMES.includes(rawProvider.toLowerCase())
        ? rawProvider.toLowerCase()
        : "pexels";
    const count = Math.min(6, Math.max(1, Number(rawCount) || 3));

    if (!q && !category) {
      throw new Error(
        "Provide q (search keywords) and/or category (hero, avatar, product, background, team, general)."
      );
    }

    // 1. Search local bank
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (orientation) params.set("orientation", orientation);
    if (provider) params.set("source", provider);
    params.set("limit", String(count));

    let localImages = [];
    try {
      const localRes = await apiFetch(`/api/v1/stock-images?${params}`);
      localImages = localRes.images || [];
    } catch (err) {
      // Local bank unavailable — fall through to external
    }

    // 2. If we have enough, return them
    if (localImages.length >= count) {
      return { content: [{ type: "text", text: formatResults(localImages.slice(0, count)) }] };
    }

    // 3. Fallback: search external API (caches results into local bank)
    const needed = count - localImages.length;
    let externalImages = [];
    try {
      const extRes = await apiFetch("/api/v1/stock-images/search-external", {
        method: "POST",
        body: { q: q || category, count: needed, orientation, provider },
      });
      externalImages = extRes.images || [];
      if (extRes.note) {
        // Rate limited or no API key — not an error, just fewer results
      }
    } catch (err) {
      // External search unavailable — return what we have
    }

    // Deduplicate by photoId
    const seen = new Set(localImages.map(i => i.photoId));
    const combined = [...localImages];
    for (const img of externalImages) {
      if (!seen.has(img.photoId)) {
        combined.push(img);
        seen.add(img.photoId);
      }
    }

    if (combined.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No stock images found for "${q || category}". Try different search terms or switch provider (unsplash/pexels).`,
          },
        ],
      };
    }

    return { content: [{ type: "text", text: formatResults(combined.slice(0, count)) }] };
  },
};

function formatResults(images) {
  const lines = images.map(img => {
    const dims =
      img.width && img.height
        ? ` (${img.orientation || "landscape"}, ${img.width}x${img.height})`
        : "";
    const tags = (img.tags || []).slice(0, 5).join(", ");
    // Build a usable URL with standard sizing params
    const baseUrl = (img.url || "").split("?")[0];
    const supportsUnsplashParams = img.source === "unsplash";
    const usableUrl = supportsUnsplashParams ? `${baseUrl}?w=800&h=600&fit=crop&q=80` : baseUrl;
    const heroUrl = supportsUnsplashParams ? `${baseUrl}?w=1600&h=900&fit=crop&q=80` : baseUrl;
    const avatarUrl = supportsUnsplashParams
      ? `${baseUrl}?w=400&h=400&fit=crop&crop=faces&q=80`
      : baseUrl;

    let urlBlock = `  URL: ${usableUrl}`;
    if (img.category === "hero" || img.category === "background") {
      urlBlock = `  Hero: ${heroUrl}\n  Standard: ${usableUrl}`;
    } else if (img.category === "avatar") {
      urlBlock = `  Avatar: ${avatarUrl}\n  Standard: ${usableUrl}`;
    }

    return `• \`${img.photoId}\` — ${tags}${dims}\n${urlBlock}`;
  });

  return `Found ${images.length} image${images.length === 1 ? "" : "s"}:\n${lines.join("\n\n")}\n\nUse in Image nodes: propsPatch { "type": "url", "src": "<url>" }. Append ?w=WIDTH&h=HEIGHT&fit=crop&q=80 to resize.`;
}
