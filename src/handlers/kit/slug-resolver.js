const { apiFetch } = require("../../core/api-fetch");

/**
 * Fetch a published library block by slug, with fuzzy fallback when the
 * model invents a plausible-but-wrong slug. Returns { componentRes, resolvedSlug }.
 *
 * Throws if no reasonable match can be found in the library text search.
 */
async function fetchComponentBySlugWithFallback(rawSlug) {
  let resolvedSlug = rawSlug;
  let componentRes;

  try {
    componentRes = await apiFetch(`/api/v1/components/${encodeURIComponent(resolvedSlug)}`);
  } catch (err) {
    const msg = err?.message || String(err);
    const isNotFound = /not found|404/i.test(msg);
    if (!isNotFound) throw err;

    // Model often invents plausible slugs; try library text search and fuzzy matching.
    const searchTerms = rawSlug.replace(/[-_]+/g, " ");
    const searchRes = await apiFetch(
      `/api/v1/components?q=${encodeURIComponent(searchTerms)}&limit=25`
    );
    const hits = searchRes.components || [];
    const lower = rawSlug.toLowerCase();
    const exact = hits.find(c => c.slug === rawSlug || c.slug === lower);
    const ci = hits.find(c => String(c.slug).toLowerCase() === lower);
    // Name-to-slug: model sees "Testimonial Card" and invents "testimonial-card"
    const slugFromName = name =>
      String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const nameMatch = hits.find(c => slugFromName(c.name) === lower);
    const lone = hits.length === 1 ? hits[0] : null;

    // Fuzzy: score by word overlap between invented slug and real slugs
    let fuzzy = null;
    if (!exact && !ci && !nameMatch && !lone && hits.length > 0) {
      const words = lower.replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean);
      let bestScore = 0;
      for (const c of hits) {
        const slugWords = c.slug.replace(/[-_]+/g, " ").split(/\s+/);
        const nameWords = String(c.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .split(/\s+/);
        const allWords = new Set([...slugWords, ...nameWords]);
        const score = words.filter(w => allWords.has(w)).length;
        if (score > bestScore) {
          bestScore = score;
          fuzzy = c;
        }
      }
      // Require at least 2 word matches to avoid random picks
      if (bestScore < 2) fuzzy = null;
    }

    const pick = exact || ci || nameMatch || lone || fuzzy;

    if (!pick) {
      const available = hits
        .slice(0, 8)
        .map(c => `\`${c.slug}\``)
        .join(", ");
      throw new Error(
        `No kit block "${rawSlug}" (404). Do not invent slugs — copy exactly from search_blocks results.${
          available
            ? ` Available from search: ${available}.`
            : " Call search_blocks(category) first."
        }`
      );
    }
    resolvedSlug = pick.slug;
    componentRes = await apiFetch(`/api/v1/components/${encodeURIComponent(resolvedSlug)}`);
  }

  return { componentRes, resolvedSlug };
}

module.exports = { fetchComponentBySlugWithFallback };
