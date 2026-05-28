const crypto = require("crypto");
const { getContext } = require("../../core/context");
const {
  getActiveTarget,
  parseMaybeJson,
  saveTarget,
  fetchTarget,
  decodeContentOrThrow,
  mergeBlockModifiersIntoRoot,
} = require("../../helpers/index.js");
const { normalizeBaseUrl } = require("../../core/api-fetch");
const {
  hierarchicalStructureToFlat,
  walkApplyKitOverrides,
  flatLibraryToHierarchical,
} = require("../../codec/structure-ingest");

const { collectSubtree } = require("../../utils/node-utils");
const { recordFillPatch } = require("../../helpers/fill-patch-merge");
const { resolveToolDefaultPageNodeId } = require("../../core/active-page");
const { stashPendingPunchList } = require("./punch-list-state");

const {
  stashKitLabelMap,
  findUnrewrittenCopy,
  findUnreplacedImages,
  formatUnrewrittenCopyPunchList,
  formatUnreplacedImagesPunchList,
} = require("./punch-list");
const { formatKitNodeIdManifest } = require("./manifest");
const { unwrapBlockStructure } = require("./unwrap");
const { SLOT_MAP, resolveSlotTarget } = require("./slot-guard");
const { fetchComponentBySlugWithFallback } = require("./slug-resolver");

async function applyKitBlockBody(args) {
    const {
      slug,
      sourceNodeId,
      sectionContainerId: argSectionId,
      contentOverrides,
      propOverrides,
    } = args;
    const hasSlug = typeof slug === "string" && slug.trim().length > 0;
    const hasSourceNodeId = typeof sourceNodeId === "string" && sourceNodeId.trim().length > 0;
    if (!hasSlug && !hasSourceNodeId) {
      throw new Error(
        "Pass either `slug` (from search_blocks) to stamp a library block, or `sourceNodeId` to adapt an existing site section (also shown by search_blocks under 'Reusable from this site')."
      );
    }
    if (hasSlug && hasSourceNodeId) {
      throw new Error(
        "Pass `slug` OR `sourceNodeId`, not both. Use `slug` for a fresh library block; use `sourceNodeId` to clone a section already on this site."
      );
    }
    const cloneMode = hasSourceNodeId && !hasSlug;

    let slotTarget = args.target; // "header", "footer", or undefined (page)
    let slotMismatchWarning = null;
    if (cloneMode && slotTarget) {
      throw new Error(
        "sourceNodeId clones a PAGE SECTION; the header/footer slots take a fresh `slug` for a navbar / footer block."
      );
    }

    ({ slotTarget, slotMismatchWarning } = resolveSlotTarget(slotTarget, slug));

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
    // Clone path (sourceNodeId) bypasses this — cloning the same on-site
    // pattern into multiple sections is a legitimate use case.
    if (!ctx._appliedKitSlugs) ctx._appliedKitSlugs = new Set();
    if (!cloneMode && ctx._appliedKitSlugs.has(slug)) {
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
      sourceNodeId: _srcNodeId,
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

    let rawSlug;
    let resolvedSlug;
    let component;
    let componentStyles = [];
    let structure;
    let sourceMeta;

    if (cloneMode) {
      // ── Adapt path: clone an existing section subtree from this site ──────
      const srcId = String(sourceNodeId).trim();
      const sourceNode = flat[srcId];
      if (!sourceNode) {
        throw new Error(
          `sourceNodeId "${srcId}" not found on this site. Pick one from the "Reusable from this site" list in search_blocks results.`
        );
      }
      if (sourceNode.props?.type !== "section") {
        throw new Error(
          `sourceNodeId "${srcId}" is not a page section (props.type must be "section"). Only full sections can be adapted; for smaller pieces use add_nodes.`
        );
      }
      if (srcId === parentNodeId) {
        throw new Error(
          `sourceNodeId and target section are the same node ("${srcId}") — cannot clone a section into itself.`
        );
      }
      const originSource = sourceNode.custom?.source || null;
      const originBlockSlug =
        originSource?.type === "block" && typeof originSource.block === "string"
          ? originSource.block
          : null;
      componentStyles = Array.isArray(originSource?.styles)
        ? originSource.styles
        : originSource?.style
          ? [originSource.style]
          : [];

      // Convert the live subtree to the {type, props, children} shape the
      // flattener expects, then scrub identifiers + source stamps so the
      // clone re-stamps with fresh ids and its own provenance.
      const hierarchical = flatLibraryToHierarchical(flat, srcId);
      (function scrub(n) {
        if (n?.props && typeof n.props === "object") {
          delete n.props.id;
          if (n.props.custom && typeof n.props.custom === "object") {
            delete n.props.custom.source;
          }
        }
        if (Array.isArray(n.children)) n.children.forEach(scrub);
      })(hierarchical);

      structure = hierarchical;
      resolvedSlug = originBlockSlug
        ? `${originBlockSlug}-clone`
        : `clone-${srcId.replace(/[^a-zA-Z0-9]+/g, "")}`;
      rawSlug = resolvedSlug;
      component = {
        name: sourceNode.custom?.displayName || "Adapted section",
        preset: originSource?.preset || null,
        styles: componentStyles,
        modifiers: null,
      };
      sourceMeta = {
        type: "site-clone",
        fromNodeId: srcId,
        ...(originBlockSlug ? { originalBlock: originBlockSlug } : {}),
        ...(originSource?.preset ? { preset: originSource.preset } : {}),
        ...(componentStyles.length ? { styles: componentStyles } : {}),
        appliedAt: new Date().toISOString(),
      };
    } else {
      // ── Library path: fetch the published block by slug ───────────────────
      rawSlug = String(slug).trim();
      const fetched = await fetchComponentBySlugWithFallback(rawSlug);
      resolvedSlug = fetched.resolvedSlug;
      const componentRes = fetched.componentRes;

      component = componentRes.component;
      if (!component?.structure) {
        throw new Error(`Block "${resolvedSlug}" has no structure.`);
      }

      componentStyles = Array.isArray(component.styles)
        ? component.styles
        : component.style
          ? [component.style]
          : [];

      // For header/footer slots, keep the block's section wrapper intact (it's the slot's direct child).
      // For page sections, unwrap to avoid nesting two section shells.
      const decodedStructure = decodeContentOrThrow(
        component.structure,
        `Component "${resolvedSlug}" structure`
      );
      structure = slotTarget ? decodedStructure : unwrapBlockStructure(decodedStructure);

      sourceMeta = {
        type: "block",
        block: resolvedSlug,
        ...(component.preset ? { preset: component.preset } : {}),
        ...(componentStyles.length ? { styles: componentStyles } : {}),
        ...(component.version ? { version: component.version } : {}),
        appliedAt: new Date().toISOString(),
      };
    }

    // Track preset/styles of applied blocks for cohesion hints in search_blocks
    if (component.preset || componentStyles.length) {
      if (!ctx._appliedBlockMeta) ctx._appliedBlockMeta = [];
      ctx._appliedBlockMeta.push({ preset: component.preset, styles: componentStyles });
    }

    const co = parseMaybeJson(contentOverrides) || contentOverrides || {};
    const po = parseMaybeJson(propOverrides) || propOverrides || {};
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
        if (sectionContainerId && sectionContainerId !== parentNodeId && flat[sectionContainerId]) {
          patch[sectionContainerId] = flat[sectionContainerId];
        }
        recordFillPatch(ctx, patch);
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
      const verb = cloneMode
        ? `Adapted section "${component.name}" from \`${sourceNodeId}\``
        : `Applied kit block "${component.name}" (\`${resolvedSlug}\`)`;
      const resolvedNote =
        !cloneMode && resolvedSlug !== rawSlug ? ` (resolved from "${rawSlug}")` : "";
      const slotMismatchTail = slotMismatchWarning ? `\n\n${slotMismatchWarning}` : "";
      const summary = `${verb} — ${Object.keys(newNodes).length} nodes.${resolvedNote}${slotMismatchTail}${warnText}${punchList}${imagePunchList}\n\n${formatKitNodeIdManifest(newNodes, rootId, parentNodeId)}`;
      if (!cloneMode) {
        ctx._appliedKitSlugs.add(slug);
        if (resolvedSlug && resolvedSlug !== slug) ctx._appliedKitSlugs.add(resolvedSlug);
        stashKitLabelMap(ctx, resolvedSlug, newNodes);
        if (slug !== resolvedSlug) stashKitLabelMap(ctx, slug, newNodes);
      } else {
        stashKitLabelMap(ctx, resolvedSlug, newNodes);
      }
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
    const verb = cloneMode
      ? `Adapted section "${component.name}" from \`${sourceNodeId}\``
      : `Applied kit block "${resolvedSlug}"`;
    const slotMismatchTail = slotMismatchWarning ? `\n\n${slotMismatchWarning}` : "";
    const msg =
      target.type === "template"
        ? `${verb} to template "${result.id}".${slotMismatchTail}${warnText}${punchList}${imagePunchList}`
        : `${verb}.${slotMismatchTail}${warnText}${punchList}${imagePunchList}\nEditor: ${base}/build/${result.id}`;
    if (!cloneMode) {
      ctx._appliedKitSlugs.add(slug);
      if (resolvedSlug && resolvedSlug !== slug) ctx._appliedKitSlugs.add(resolvedSlug);
      stashKitLabelMap(ctx, resolvedSlug, newNodes);
      if (slug !== resolvedSlug) stashKitLabelMap(ctx, slug, newNodes);
    } else {
      stashKitLabelMap(ctx, resolvedSlug, newNodes);
    }
    return { content: [{ type: "text", text: msg }], changedNodes };
}

module.exports = { applyKitBlockBody };
