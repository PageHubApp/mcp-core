/**
 * Stock photo discovery tool — `find_image`. Searches the local image bank
 * first, then falls back to external providers (Unsplash / Pexels) when the
 * local cache is short.
 */

const { apiFetch } = require("../core/api-fetch");

const IMAGE_PROVIDER_NAMES = ["unsplash", "pexels"];

module.exports = {
  /**
   * Search for stock photos by query / category / orientation; returns
   * verified working image URLs from the local bank with external fallback.
   * @param {object} args - { q?, category?, orientation?, provider?, count? }
   * @returns {Promise<{content: Array<{type:'text', text:string}>}>}
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
        "q (search keywords) and/or category is required. e.g. category: hero | avatar | product | background | team | general."
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
    // The bank stores the provider's ORIGINAL url, and stripping the query is
    // what keeps it original. Handing back a `?w=800&q=80` variant instead
    // pinned every stock photo to a soft, hard-cropped 800px — and if the
    // caller then uploaded it, stored it at that size permanently.
    const originalUrl = (img.url || "").split("?")[0];
    return `• \`${img.photoId}\` — ${tags}${dims}\n  URL: ${originalUrl}`;
  });

  return (
    `Found ${images.length} image${images.length === 1 ? "" : "s"} — urls are full-resolution originals:\n` +
    `${lines.join("\n\n")}\n\n` +
    `Next step: upload_image({ imageUrl: "<url>" }), then set the Image node to ` +
    `{ "type": "cdn", "src": "<returned mediaId>" }. On the CDN the viewer serves a ` +
    `per-viewport srcset with format=auto (AVIF/WebP), sized from the original.\n` +
    `Do NOT use { "type": "url" } against the provider — it pins one fixed size, skips ` +
    `the srcset, and leaves the site depending on a third party staying up. Do NOT append ` +
    `?w= / &h= / q= before uploading: crop and display size are layout concerns the CDN ` +
    `resolves from the full-resolution original.`
  );
}
