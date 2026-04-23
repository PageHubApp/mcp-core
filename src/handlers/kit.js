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
} = require("../helpers");
const { normalizeBaseUrl } = require("../api-fetch");
const { hierarchicalStructureToFlat, walkApplyKitOverrides } = require("../structure-ingest");

const { collectSubtree } = require("../node-utils");
const { resolveToolDefaultPageNodeId } = require("../active-page");

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

    for (const [id, node] of Object.entries(newNodes)) {
      flat[id] = node;
    }

    const parentNodes = flat[parentNodeId].nodes || [];
    const position = args.position != null ? args.position : parentNodes.length;
    parentNodes.splice(position, 0, rootId);
    flat[parentNodeId].nodes = parentNodes;

    // Merge block-level modifiers into site ROOT so they're available globally
    if (component.modifiers && typeof component.modifiers === "object") {
      const rootNode = flat.ROOT || flat.root;
      if (rootNode) {
        const rootProps = rootNode.props || rootNode;
        if (!rootProps.modifiers) rootProps.modifiers = {};
        for (const [typeName, mods] of Object.entries(component.modifiers)) {
          if (!Array.isArray(mods)) continue;
          if (!rootProps.modifiers[typeName]) rootProps.modifiers[typeName] = [];
          for (const mod of mods) {
            if (!rootProps.modifiers[typeName].some(m => m.name === mod.name)) {
              rootProps.modifiers[typeName].push(mod);
            }
          }
        }
      }
    }

    const changedNodes = {};
    for (const id of Object.keys(newNodes)) {
      Object.assign(changedNodes, collectSubtree(flat, id));
    }
    Object.assign(changedNodes, collectSubtree(flat, parentNodeId));

    if (ctx.draftMode) {
      if (ctx.fillMode) {
        const patch = { ...newNodes };
        patch[sectionContainerId] = flat[sectionContainerId];
        if (!ctx._fillPatch) ctx._fillPatch = {};
        Object.assign(ctx._fillPatch, patch);
        ctx._pendingFlatMap = flat;
      } else {
        ctx._pendingFlatMap = flat;
      }
      const warnText = overrideWarnings.length
        ? `\n\nOverride warnings:\n${overrideWarnings.map(w => `  - ${w}`).join("\n")}`
        : "";
      const summary = `Applied kit block "${component.name}" (\`${resolvedSlug}\`) — ${Object.keys(newNodes).length} nodes.${resolvedSlug !== rawSlug ? ` (resolved from "${rawSlug}")` : ""}${warnText}\n\n${formatKitNodeIdManifest(newNodes, rootId, parentNodeId)}`;
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
    const msg =
      target.type === "template"
        ? `Applied kit block "${resolvedSlug}" to template "${result.id}".${warnText}`
        : `Applied kit block "${resolvedSlug}".${warnText}\nEditor: ${base}/build/${result.id}`;
    ctx._appliedKitSlugs.add(slug);
    if (resolvedSlug && resolvedSlug !== slug) ctx._appliedKitSlugs.add(resolvedSlug);
    stashKitLabelMap(ctx, resolvedSlug, newNodes);
    if (slug !== resolvedSlug) stashKitLabelMap(ctx, slug, newNodes);
    return { content: [{ type: "text", text: msg }], changedNodes };
  },
};
