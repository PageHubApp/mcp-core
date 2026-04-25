const crypto = require("crypto");
const { twMerge } = require("tailwind-merge");
const { apiFetch } = require("../api-fetch");
const { getContext } = require("../context");
const {
  getActiveTarget,
  parseMaybeJson,
  saveTarget,
  fetchTarget,
  decodeContentOrThrow,
  mergeBlockModifiersIntoRoot,
} = require("../helpers");
const { normalizeBaseUrl } = require("../api-fetch");
const { hierarchicalStructureToFlat, walkApplyKitOverrides } = require("../structure-ingest");

const { collectSubtree } = require("../node-utils");
const { resolveToolDefaultPageNodeId } = require("../active-page");
const { stashPendingPunchList } = require("./_punch-list-state");

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
    const raw = t === "Text" ? stripTextHtml(node?.props?.text) : String(node?.props?.text || "").trim();
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
 * Find Image nodes in the kit that still carry the kit's default/seed src
 * (or no src at all). Without this list, agents skip image work entirely:
 * the model assumes "the kit shipped with images, those are fine" and the
 * visitor sees stock placeholder photos that have nothing to do with the
 * business. Surface them so the agent has a concrete action item to call
 * `find_image` against.
 *
 * Returns up to `limit` entries: { nodeId, label, current }.
 */
function findUnreplacedImages(newNodes, limit = 12) {
  const out = [];
  for (const [id, node] of Object.entries(newNodes)) {
    const t = node?.type?.resolvedName;
    if (t !== "Image") continue;
    const props = node?.props || {};
    const src = String(props.src || "").trim();
    const label = node?.custom?.displayName || "(unnamed)";
    // Always flag — the agent has no way to tell whether the kit's seed
    // image suits the user's business; safer to ask it to swap every Image.
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
    `  STEP 1 — Call find_image({ q: "<descriptive query for THIS image's role>", category: "<hero|product|background|avatar|...>" }) ONCE PER Image above. The URL returned is the ONLY verified source.\n` +
    `  STEP 2 — Issue patch_site_bulk to set { src: "<url returned by find_image>", type: "url", alt: "<descriptive>" } on each Image node. Bundle these into the SAME patch_site_bulk as any copy patches from the punch list above.\n` +
    `NEVER hand-type images.unsplash.com URLs — invented photo IDs 404 in production and the server rejects the patch (wasted tool call). Only URLs returned by find_image are valid.`
  );
}

function formatKitNodeIdManifest(newNodes, rootId, sectionContainerId, maxLines = 80) {
  const ids = Object.keys(newNodes).sort();
  const head = ids.slice(0, maxLines);

  // Label → id map. Models tend to invent ids like `kit_cta_simple_heading`
  // by pattern-matching labels; giving them a copy-pasteable JSON map removes
  // any need to guess. Keys are the exact labels; values are the real ids.
  const labelMap = {};
  for (const id of head) {
    const n = newNodes[id];
    const label = n?.custom?.displayName || n?.type?.resolvedName || id;
    if (labelMap[label]) {
      // duplicate labels (e.g. repeated "Title") — keep array of ids
      if (!Array.isArray(labelMap[label])) labelMap[label] = [labelMap[label]];
      labelMap[label].push(id);
    } else {
      labelMap[label] = id;
    }
  }
  const tail =
    ids.length > maxLines ? `\n  …and ${ids.length - maxLines} more (same \`kit_…\` prefix)` : "";
  return (
    `Section container: \`${sectionContainerId}\`\n` +
    `Kit root id: \`${rootId}\`\n` +
    `LABEL→ID MAP (copy ids EXACTLY from the right-hand side — do NOT invent semantic ids like \`kit_<slug>_heading\`; those do not exist):\n` +
    "```json\n" +
    JSON.stringify(labelMap, null, 2) +
    "\n```" +
    tail
  );
}

/**
 * Skeleton sections are already empty section containers. Block library roots are often
 * another `type: "section"` wrapper — unwrap so we don't nest two section shells.
 */
function unwrapBlockStructure(structure) {
  if (!structure || typeof structure !== "object") return structure;
  if (structure.type === "Container" && structure.props?.type === "section") {
    const p = structure.props || {};
    const shellClass = twMerge(
      "flex flex-col w-full",
      typeof p.className === "string" ? p.className : ""
    );
    return {
      type: "Container",
      props: {
        canDelete: true,
        canEditName: true,
        root: { ...(p.root || {}) },
        className: shellClass,
        ...(p.custom ? { custom: p.custom } : {}),
        // Block roots often carry connector bindings + DOM hook attrs; do not drop on unwrap.
        ...(p.dataSource ? { dataSource: p.dataSource } : {}),
        ...(p.attrs ? { attrs: p.attrs } : {}),
      },
      children: structure.children || [],
    };
  }
  return structure;
}

module.exports = {
  /**
   * Apply a published library block (by slug) into an existing section container.
   * Prefer this in fill mode over hand-built graphs: search_blocks → apply_kit_block.
   */
  async apply_kit_block(args) {
    const { slug, sectionContainerId: argSectionId, contentOverrides, propOverrides } = args;
    if (!slug || typeof slug !== "string")
      throw new Error("slug is required (from search_blocks).");

    const slotTarget = args.target; // "header", "footer", or undefined (page)
    const SLOT_MAP = { header: "hdr_root", footer: "ftr_root" };

    // Slot-target guardrail: qwen (and friends) read "header" as "top of page" and route
    // heroes / features / CTAs into hdr_root, which clears real header chrome and buries
    // the section inside a layout slot that downstream code assembles differently (the
    // kit also then tends to drop before final save — see AiLog 2026-04-24T15:48 for the
    // "wills balls" case where the hero was applied under hdr_root and vanished from
    // sharedDraft). Only accept slot targets for slugs that are actually header/footer
    // blocks. Everything else must go on a page (the default, `target: "page"`).
    if (slotTarget && SLOT_MAP[slotTarget]) {
      const slugLower = String(slug).toLowerCase();
      const isHeaderSlug = /(^|[-_])(header|nav(bar)?|top[-_]?bar|menu[-_]?bar)(-|$)/.test(slugLower);
      const isFooterSlug = /(^|[-_])footer(-|$)/.test(slugLower);
      if (slotTarget === "header" && !isHeaderSlug) {
        throw new Error(
          `apply_kit_block: target "header" is reserved for header blocks (navbars / menu bars). ` +
            `Slug "${slug}" doesn't look like a header block — its kit will be placed inside hdr_root (the global header slot), which is NOT where page sections live. ` +
            `Use target: "page" (or omit target) to add this block as a section on the current page.`
        );
      }
      if (slotTarget === "footer" && !isFooterSlug) {
        throw new Error(
          `apply_kit_block: target "footer" is reserved for footer blocks. ` +
            `Slug "${slug}" doesn't look like a footer block — use target: "page" (or omit target) to add it as a page section instead.`
        );
      }
    }

    const ctx = getContext();
    if (ctx.fillMode && ctx._fillStructureLocked) {
      throw new Error(
        "This fill already applied a kit or add_nodes. Use patch_site_node / patch_site_bulk only — do not stack a second apply_kit_block."
      );
    }
    // Per-turn dedupe: block the same slug being applied twice in one agent
    // turn. Agents sometimes retry apply_kit_block after an unrelated tool
    // error (e.g. a rejected patch with a hallucinated id) without noticing
    // the first apply already landed, which appends a duplicate section.
    if (!ctx._appliedKitSlugs) ctx._appliedKitSlugs = new Set();
    if (ctx._appliedKitSlugs.has(slug)) {
      throw new Error(
        `Kit block "${slug}" was already applied in this turn — the first apply succeeded. ` +
          `Use its returned kit_* node ids to patch content, or apply a DIFFERENT slug if you want a second section. ` +
          `Do not re-apply the same slug: it creates a duplicate section.`
      );
    }
    let sectionContainerId = argSectionId || ctx.sectionNodeId;
    // Parallel fills: always pin to the worker's section — ignore a wrong model-supplied id.
    if (ctx.fillMode && ctx.sectionNodeId) {
      sectionContainerId = String(ctx.sectionNodeId);
    }
    if (ctx.fillMode && !sectionContainerId && !slotTarget) {
      throw new Error(
        "sectionContainerId is required in fill mode. Use the section id from the planner (e.g. sec_hero)."
      );
    }
    // Non-fill: if no container specified, drop block directly into the page node
    const directToPage = !ctx.fillMode && !sectionContainerId && !slotTarget;

    // Strip block-specific params so getActiveTarget doesn't interpret slug as a template slug
    const {
      slug: _blockSlug,
      sectionContainerId: _sec,
      contentOverrides: _co,
      propOverrides: _po,
      position: _pos,
      pageId: _pid,
      copyContext: _cc,
      target: _tgt,
      ...targetArgs
    } = args;
    const target = getActiveTarget(targetArgs);

    // Fill mode for sites: reload merged draft (live published content has no sec_* skeleton nodes)
    if (!ctx._pendingFlatMap && ctx.fillMode && target.type === "site") {
      if (typeof ctx._reloadMergedDraft === "function") {
        await ctx._reloadMergedDraft();
      }
      if (!ctx._pendingFlatMap || typeof ctx._pendingFlatMap !== "object") {
        throw new Error(
          "No AI draft loaded for this fill. The planner skeleton (signal_sections) may not be in the database yet — retry in a moment, or run the planner again."
        );
      }
    }

    let { flat } = await fetchTarget(targetArgs);

    const pageId =
      resolveToolDefaultPageNodeId({ flat, ctx, explicitPageId: args.pageId }) || "page_home";

    // Resolve parent node: slot (header/footer), section container, or page
    let parentNodeId;
    if (slotTarget && SLOT_MAP[slotTarget]) {
      parentNodeId = SLOT_MAP[slotTarget];
      if (!flat[parentNodeId]) {
        throw new Error(
          `Slot "${slotTarget}" (node "${parentNodeId}") not found. Is this a PageHub site/template?`
        );
      }
      // Clear existing children of the slot before inserting the new block
      const oldChildren = [...(flat[parentNodeId].nodes || [])];
      for (const childId of oldChildren) {
        const subtree = collectSubtree(flat, childId);
        for (const id of Object.keys(subtree)) delete flat[id];
      }
      flat[parentNodeId].nodes = [];
    } else if (directToPage) {
      parentNodeId = pageId;
      if (!flat[pageId]) {
        throw new Error(
          `Page "${pageId}" not found in site. Use list_pages to see available pages.`
        );
      }
    } else {
      parentNodeId = sectionContainerId;
      if (
        !flat[sectionContainerId] &&
        ctx.fillMode &&
        typeof ctx._reloadMergedDraft === "function"
      ) {
        await ctx._reloadMergedDraft();
        ({ flat } = await fetchTarget(targetArgs));
      }
      if (!flat[sectionContainerId]) {
        if (!ctx.fillMode) {
          // Non-fill mode: fall back to adding directly to the page instead of failing
          parentNodeId = pageId;
          sectionContainerId = null;
          if (!flat[pageId]) {
            throw new Error(
              `Section container "${argSectionId}" not found, and page "${pageId}" not found either. ` +
                `Omit sectionContainerId and pass the correct pageId (e.g. "page_services") to add directly to the page. Use list_pages to see available pages.`
            );
          }
        } else {
          throw new Error(
            `Section container "${sectionContainerId}" not found. ` +
              "Use the section id from the planner (e.g. sec_hero). If you just ran signal_sections, retry once the draft has synced."
          );
        }
      }
    }

    const rawSlug = String(slug).trim();
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

    const { component } = componentRes;
    if (!component?.structure) {
      throw new Error(`Block "${resolvedSlug}" has no structure.`);
    }

    // Track preset/styles of applied blocks for cohesion hints in search_blocks
    const componentStyles = Array.isArray(component.styles)
      ? component.styles
      : component.style
        ? [component.style]
        : [];
    if (component.preset || componentStyles.length) {
      if (!ctx._appliedBlockMeta) ctx._appliedBlockMeta = [];
      ctx._appliedBlockMeta.push({ preset: component.preset, styles: componentStyles });
    }

    // For header/footer slots, keep the block's section wrapper intact (it's the slot's direct child).
    // For page sections, unwrap to avoid nesting two section shells.
    const decodedStructure = decodeContentOrThrow(
      component.structure,
      `Component "${resolvedSlug}" structure`
    );
    const structure = slotTarget ? decodedStructure : unwrapBlockStructure(decodedStructure);
    const co = parseMaybeJson(contentOverrides) || contentOverrides || {};
    const po = parseMaybeJson(propOverrides) || propOverrides || {};

    const sourceMeta = {
      type: "block",
      block: resolvedSlug,
      ...(component.preset ? { preset: component.preset } : {}),
      ...(componentStyles.length ? { styles: componentStyles } : {}),
      ...(component.version ? { version: component.version } : {}),
      appliedAt: new Date().toISOString(),
    };
    let newNodes;
    let rootId;
    let idSalt = "";
    for (let attempt = 0; attempt < 24; attempt++) {
      const built = hierarchicalStructureToFlat(
        structure,
        parentNodeId,
        resolvedSlug,
        sourceMeta,
        idSalt
      );
      newNodes = built.nodes;
      rootId = built.rootId;
      if (!Object.keys(newNodes).some(id => flat[id])) break;
      idSalt = crypto.randomBytes(8).toString("hex");
    }
    const colliding = Object.keys(newNodes).find(id => flat[id]);
    if (colliding) {
      throw new Error(
        `Internal error: node id "${colliding}" still collided after retries. Try a different block or report a bug.`
      );
    }
    const overrideWarnings = walkApplyKitOverrides(newNodes, rootId, co, po) || [];

    // ─── Collapse the kit's outer Container into an empty section skeleton ────
    // signal_sections / fresh page sections create an empty `type: "section"`
    // Container as a placeholder. Without collapse, apply_kit_block nests the
    // kit's section wrapper as a CHILD of that placeholder — two Containers
    // where there should be one, which makes the skeleton render as a thin
    // wrapper and its inner kit_*_n0 carry the real section styling. The
    // editor's section affordances hang off the skeleton; the visuals hang off
    // the inner node — they decouple. Collapsing merges the kit wrapper's
    // visual props (className, dataSource, attrs, root, custom.source) onto
    // the skeleton and re-parents the kit's children directly under it, so
    // the result matches a hand-dragged Block: one section node carrying the
    // kit's styling.
    const parentNode = flat[parentNodeId];
    const wrapperNode = newNodes[rootId];
    const canCollapseIntoSkeleton =
      !slotTarget &&
      !directToPage &&
      parentNode &&
      parentNode.props?.type === "section" &&
      (!Array.isArray(parentNode.nodes) || parentNode.nodes.length === 0) &&
      wrapperNode &&
      wrapperNode.type?.resolvedName === "Container";

    if (canCollapseIntoSkeleton) {
      const wrapperProps = wrapperNode.props || {};
      const parentProps = parentNode.props || {};
      // Take wrapper's visuals; preserve skeleton identity (`type:"section"`,
      // user-facing displayName, page-section flags).
      parentNode.props = {
        ...wrapperProps,
        ...parentProps,
        className:
          typeof wrapperProps.className === "string" && wrapperProps.className.trim()
            ? wrapperProps.className
            : parentProps.className,
        ...(wrapperProps.dataSource ? { dataSource: wrapperProps.dataSource } : {}),
        ...(wrapperProps.attrs ? { attrs: wrapperProps.attrs } : {}),
        ...(wrapperProps.root
          ? { root: { ...(parentProps.root || {}), ...wrapperProps.root } }
          : {}),
      };
      // Merge custom: wrapper carries `source` (block provenance); skeleton
      // carries `displayName` ("Hero" set by the planner). Parent wins overall.
      parentNode.custom = {
        ...(wrapperNode.custom || {}),
        ...(parentNode.custom || {}),
        ...(wrapperNode.custom?.source ? { source: wrapperNode.custom.source } : {}),
      };
      // Re-parent the wrapper's children directly under the skeleton.
      const wrapperChildIds = Array.isArray(wrapperNode.nodes) ? [...wrapperNode.nodes] : [];
      for (const childId of wrapperChildIds) {
        if (newNodes[childId]) newNodes[childId].parent = parentNodeId;
      }
      parentNode.nodes = wrapperChildIds;
      // Drop the wrapper — its visuals + children already moved onto the parent.
      delete newNodes[rootId];
      // Downstream logic (changedNodes, fillPatch, debug log) still snapshots
      // by id; rootId now points at the skeleton itself.
      rootId = parentNodeId;
    }

    for (const [id, node] of Object.entries(newNodes)) {
      flat[id] = node;
    }

    if (!canCollapseIntoSkeleton) {
      const parentNodes = flat[parentNodeId].nodes || [];
      const position = args.position != null ? args.position : parentNodes.length;
      parentNodes.splice(position, 0, rootId);
      flat[parentNodeId].nodes = parentNodes;
    }

    mergeBlockModifiersIntoRoot(flat, component.modifiers);

    const changedNodes = {};
    for (const id of Object.keys(newNodes)) {
      Object.assign(changedNodes, collectSubtree(flat, id));
    }
    Object.assign(changedNodes, collectSubtree(flat, parentNodeId));

    if (process.env.DEBUG_SLOT_KITS === "1" && slotTarget) {
      console.log(
        `[slot-kits] apply_kit_block target="${slotTarget}" → parent=${parentNodeId} | added ${Object.keys(newNodes).length} nodes | flat[${parentNodeId}].nodes after insert = ${JSON.stringify(flat[parentNodeId]?.nodes)}`
      );
    }
    if (ctx.draftMode) {
      if (ctx.fillMode) {
        // Snapshot the REAL parent whose `.nodes` now references the new kit children.
        // For slot targets (target: "footer" / "header") that's ftr_root / hdr_root; for
        // normal section fills it's sectionContainerId. Previously we always snapshotted
        // sectionContainerId, so footer fills dropped the kit under ftr_root but saved the
        // untouched sec_footer — the kit nodes ended up orphaned when the client merged
        // aiDraftPatches back onto the base site and the footer rendered as empty.
        const patch = { ...newNodes };
        if (parentNodeId && flat[parentNodeId]) {
          patch[parentNodeId] = flat[parentNodeId];
        }
        // Keep sectionContainerId in the patch too so the planner's empty skeleton slot
        // stays consistent (idempotent — if parentNodeId === sectionContainerId the above
        // already covered it).
        if (
          sectionContainerId &&
          sectionContainerId !== parentNodeId &&
          flat[sectionContainerId]
        ) {
          patch[sectionContainerId] = flat[sectionContainerId];
        }
        if (!ctx._fillPatch) ctx._fillPatch = {};
        Object.assign(ctx._fillPatch, patch);
        ctx._pendingFlatMap = flat;
      } else {
        ctx._pendingFlatMap = flat;
      }
      const warnText = overrideWarnings.length
        ? `\n\nOverride warnings:\n${overrideWarnings.map(w => `  - ${w}`).join("\n")}`
        : "";
      const punchItems = findUnrewrittenCopy(newNodes, co);
      const imageItems = findUnreplacedImages(newNodes);
      // Stash pending punch-list ids on ctx so patch_site_bulk can prune as
      // patches arrive and surface "STILL MISSED" if the agent skips entries.
      stashPendingPunchList(ctx, [...punchItems, ...imageItems]);
      const punchList = formatUnrewrittenCopyPunchList(punchItems);
      const imagePunchList = formatUnreplacedImagesPunchList(imageItems);
      const summary = `Applied kit block "${component.name}" (\`${resolvedSlug}\`) — ${Object.keys(newNodes).length} nodes.${resolvedSlug !== rawSlug ? ` (resolved from "${rawSlug}")` : ""}${warnText}${punchList}${imagePunchList}\n\n${formatKitNodeIdManifest(newNodes, rootId, parentNodeId)}`;
      ctx._appliedKitSlugs.add(slug);
      if (resolvedSlug && resolvedSlug !== slug) ctx._appliedKitSlugs.add(resolvedSlug);
      stashKitLabelMap(ctx, resolvedSlug, newNodes);
      if (slug !== resolvedSlug) stashKitLabelMap(ctx, slug, newNodes);
      return {
        content: [{ type: "text", text: summary }],
        pendingContent: ctx.fillMode ? ctx._pendingFlatMap : flat,
        changedNodes,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
    const warnText = overrideWarnings.length
      ? `\n\nOverride warnings:\n${overrideWarnings.map(w => `  - ${w}`).join("\n")}`
      : "";
    const punchItemsSaved = findUnrewrittenCopy(newNodes, co);
    const imageItemsSaved = findUnreplacedImages(newNodes);
    stashPendingPunchList(ctx, [...punchItemsSaved, ...imageItemsSaved]);
    const punchList = formatUnrewrittenCopyPunchList(punchItemsSaved);
    const imagePunchList = formatUnreplacedImagesPunchList(imageItemsSaved);
    const msg =
      target.type === "template"
        ? `Applied kit block "${resolvedSlug}" to template "${result.id}".${warnText}${punchList}${imagePunchList}`
        : `Applied kit block "${resolvedSlug}".${warnText}${punchList}${imagePunchList}\nEditor: ${base}/build/${result.id}`;
    ctx._appliedKitSlugs.add(slug);
    if (resolvedSlug && resolvedSlug !== slug) ctx._appliedKitSlugs.add(resolvedSlug);
    stashKitLabelMap(ctx, resolvedSlug, newNodes);
    if (slug !== resolvedSlug) stashKitLabelMap(ctx, slug, newNodes);
    return { content: [{ type: "text", text: msg }], changedNodes };
  },
};
