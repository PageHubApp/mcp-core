/** Lists real Craft ids so the model does not guess (random prefixes used to break patches). */
/**
 * Normalize a label / semantic fragment for lookup:
 *   "Primary CTA"  → "primarycta"
 *   "primary_cta"  → "primarycta"
 *   "Primary-CTA"  → "primarycta"
 * So the model can refer to a node by ANY reasonable variation of its label.
 */
function normalizeLabelKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Persist a { normalizedLabel → realId } map for each applied kit slug on the
 * per-request context, so patch_site_bulk can resolve semantic ids the model
 * invents (e.g. `kit_cta_simple_heading` → `kit_cta_simple_82028ff0_n2`).
 */
function stashKitLabelMap(ctx, slug, newNodes) {
  if (!ctx || !slug || !newNodes) return;
  if (!ctx._kitLabelMaps) ctx._kitLabelMaps = {};
  const byLabel = {};
  const byType = {};
  for (const [id, n] of Object.entries(newNodes)) {
    const label = n?.custom?.displayName;
    if (label) {
      const k = normalizeLabelKey(label);
      if (k && !byLabel[k]) byLabel[k] = id;
    }
    const t = n?.type?.resolvedName;
    if (t) {
      const k = normalizeLabelKey(t);
      if (k && !byType[k]) byType[k] = id;
    }
  }
  ctx._kitLabelMaps[slug] = { byLabel, byType, firstNodeId: Object.keys(newNodes)[0] || null };
}

/**
 * Strip HTML tags from a Text node's value to compare against generic placeholders.
 */
function stripTextHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a "still has generic copy" punch list of Text/Button nodes whose
 * displayName was NOT covered by contentOverrides. Agents routinely override
 * top-level slots (Heading, Description, primary CTA, Brand) and leave
 * everything deeper (footer column links: Features/Pricing/About/Blog;
 * secondary CTAs; nav items) carrying the kit's original placeholder copy —
 * which then ships to the user as obvious filler.
 *
 * Returns up to `limit` entries: { nodeId, type, label, current }.
 */
// Eligible component types whose text the visitor reads. Link is critical:
// most footer column items (About/Blog/Privacy/Terms) and feature-card
// "Learn more" CTAs are Link nodes, not Button — missing it is what shipped
// "Privacy Policy / Terms of Service / Browse the public block library" to a
// bakery site.
const COPY_BEARING_TYPES = new Set(["Text", "Button", "Link"]);

function findUnrewrittenCopy(newNodes, contentOverrides, limit = 40) {
  const overrideKeys = new Set(
    contentOverrides && typeof contentOverrides === "object"
      ? Object.keys(contentOverrides).map(k => normalizeLabelKey(k))
      : []
  );
  const out = [];
  for (const [id, node] of Object.entries(newNodes)) {
    const t = node?.type?.resolvedName;
    if (!COPY_BEARING_TYPES.has(t)) continue;
    const label = node?.custom?.displayName || "";
    if (label && overrideKeys.has(normalizeLabelKey(label))) continue;
    const raw =
      t === "Text" ? stripTextHtml(node?.props?.text) : String(node?.props?.text || "").trim();
    if (!raw) continue;
    out.push({ nodeId: id, type: t, label: label || "(unnamed)", current: raw });
    if (out.length >= limit) break;
  }
  // Reorder: Link/Button BEFORE Text. Models routinely skim past secondary
  // CTAs and footer Link items when they're buried after a long run of Text
  // headings/bodies (observed: agent patched 8 of 11 punch entries, dropping
  // exactly the 3 Link rows that were last in the list).
  const TYPE_ORDER = { Link: 0, Button: 1, Text: 2 };
  out.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));
  return out;
}

/**
 * Snapshot each Image node's src as the block shipped it, before
 * contentOverrides run, so `findUnreplacedImages` can tell a seed photo from
 * one the agent already supplied.
 */
function collectSeedImageSrcs(newNodes) {
  const seeds = {};
  for (const [id, node] of Object.entries(newNodes || {})) {
    if (node?.type?.resolvedName !== "Image") continue;
    seeds[id] = String(node?.props?.src || "").trim();
  }
  return seeds;
}

/**
 * Find Image nodes in the kit that still carry the kit's default/seed src
 * (or no src at all). Without this list, agents skip image work entirely:
 * the model assumes "the kit shipped with images, those are fine" and the
 * visitor sees stock placeholder photos that have nothing to do with the
 * business (a product grid of heels shipped showing a t-shirt and a hoodie).
 * Images the agent already replaced via contentOverrides are left off, so the
 * list stays a real to-do rather than noise the agent learns to skim.
 *
 * Returns up to `limit` entries: { nodeId, label, current }.
 */
function findUnreplacedImages(newNodes, seedSrcById = {}, limit = 12) {
  const out = [];
  for (const [id, node] of Object.entries(newNodes)) {
    const t = node?.type?.resolvedName;
    if (t !== "Image") continue;
    const props = node?.props || {};
    const src = String(props.src || "").trim();
    if (src && id in seedSrcById && src !== seedSrcById[id]) continue;
    const label = node?.custom?.displayName || "(unnamed)";
    out.push({
      nodeId: id,
      type: "Image",
      label,
      current: src ? src.slice(0, 100) : "(empty)",
    });
    if (out.length >= limit) break;
  }
  return out;
}

function formatUnrewrittenCopyPunchList(items) {
  if (!items.length) return "";
  const rows = items.map(i => {
    const cur = i.current.length > 80 ? `${i.current.slice(0, 77)}…` : i.current;
    return `  - ${i.nodeId} (${i.type} "${i.label}"): "${cur}"`;
  });
  return (
    `\n\nSTILL-GENERIC COPY (kit placeholders the user will see as filler — rewrite all of these to match the business):\n` +
    rows.join("\n") +
    `\n\nDo NOT skip this. Footer links, nav items, and secondary CTAs above are visible to visitors and obviously generic when not customized.`
  );
}

function formatUnreplacedImagesPunchList(items) {
  if (!items.length) return "";
  const rows = items.map(i => `  - ${i.nodeId} ("${i.label}"): src="${i.current}"`);
  return (
    `\n\nIMAGES TO REPLACE (kit ships with stock seed images — they will look wrong for the user's business):\n` +
    rows.join("\n") +
    `\n\nDO THIS IN ORDER:\n` +
    `  STEP 1 — If the user already uploaded photos for this, patch their mediaIds straight in (skip STEP 2). Otherwise call find_image({ q: "<descriptive query for THIS image's role>", category: "<hero|product|background|avatar|...>" }) ONCE PER Image above.\n` +
    `  STEP 2 — Call upload_image({ id, imageUrl: "<url from find_image or the user>" }) for each. It returns a mediaId.\n` +
    `  STEP 3 — Issue ONE patch_site_bulk setting { src: "<mediaId>", type: "cdn", alt: "<descriptive>" } on each Image node, bundled with any copy patches from the list above.\n` +
    `Patches that put an images.unsplash.com URL straight into src are rejected — upload first, then patch the mediaId. A product named for one thing must never show a photo of another.`
  );
}

module.exports = {
  normalizeLabelKey,
  stashKitLabelMap,
  stripTextHtml,
  COPY_BEARING_TYPES,
  findUnrewrittenCopy,
  collectSeedImageSrcs,
  findUnreplacedImages,
  formatUnrewrittenCopyPunchList,
  formatUnreplacedImagesPunchList,
};
