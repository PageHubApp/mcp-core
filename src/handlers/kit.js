const { twMerge } = require('tailwind-merge');
const { apiFetch } = require('../api-fetch');
const { getContext } = require('../context');
const { getActiveTarget, parseMaybeJson, saveTarget, fetchTarget } = require('../helpers');
const { normalizeBaseUrl } = require('../api-fetch');
const { hierarchicalStructureToFlat, walkApplyKitOverrides } = require('../structure-ingest');

const { collectSubtree } = require('../node-utils');

/** Lists real Craft ids so the model does not guess (random prefixes used to break patches). */
function formatKitNodeIdManifest(newNodes, rootId, sectionContainerId, maxLines = 80) {
  const ids = Object.keys(newNodes).sort();
  const head = ids.slice(0, maxLines);
  const lines = head.map((id) => {
    const n = newNodes[id];
    const rn = n?.type?.resolvedName || '?';
    const label = n?.custom?.displayName ? ` label="${n.custom.displayName}"` : '';
    return `  ${id} | ${rn}${label}`;
  });
  const tail = ids.length > maxLines ? `\n  …and ${ids.length - maxLines} more (same \`kit_…\` prefix)` : '';
  return (
    `Section container: \`${sectionContainerId}\`\n` +
    `Kit root id: \`${rootId}\`\n` +
    `Use ONLY these node ids in patch_site_node / patch_site_bulk (copy exactly; never ids from get_component_schema alone):\n` +
    `${lines.join('\n')}${tail}`
  );
}

/**
 * Skeleton sections are already empty section containers. Block library roots are often
 * another `type: "section"` wrapper — unwrap so we don't nest two section shells.
 */
function unwrapBlockStructure(structure) {
  if (!structure || typeof structure !== 'object') return structure;
  if (structure.type === 'Container' && structure.props?.type === 'section') {
    const p = structure.props || {};
    const shellClass = twMerge(
      'flex flex-col w-full',
      typeof p.className === 'string' ? p.className : '',
    );
    return {
      type: 'Container',
      props: {
        canDelete: true,
        canEditName: true,
        root: { ...(p.root || {}) },
        className: shellClass,
        ...(p.custom ? { custom: p.custom } : {}),
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
    if (!slug || typeof slug !== 'string') throw new Error('slug is required (from search_blocks).');

    const slotTarget = args.target; // "header", "footer", or undefined (page)
    const SLOT_MAP = { header: 'hdr_root', footer: 'ftr_root' };

    const ctx = getContext();
    if (ctx.fillMode && ctx._fillStructureLocked) {
      throw new Error(
        'This fill already applied a kit or add_nodes. Use patch_site_node / patch_site_bulk only — do not stack a second apply_kit_block.'
      );
    }
    let sectionContainerId = argSectionId || ctx.sectionNodeId;
    // Parallel fills: always pin to the worker's section — ignore a wrong model-supplied id.
    if (ctx.fillMode && ctx.sectionNodeId) {
      sectionContainerId = String(ctx.sectionNodeId);
    }
    if (ctx.fillMode && !sectionContainerId && !slotTarget) {
      throw new Error(
        'sectionContainerId is required in fill mode. Use the section id from the planner (e.g. sec_hero).'
      );
    }
    // Non-fill: if no container specified, drop block directly into the page node
    const directToPage = !ctx.fillMode && !sectionContainerId && !slotTarget;
    const pageId = args.pageId || 'page_home';

    // Strip block-specific params so getActiveTarget doesn't interpret slug as a template slug
    const { slug: _blockSlug, sectionContainerId: _sec, contentOverrides: _co, propOverrides: _po, position: _pos, pageId: _pid, copyContext: _cc, target: _tgt, ...targetArgs } = args;
    const target = getActiveTarget(targetArgs);

    // Fill mode for sites: reload merged draft (live published content has no sec_* skeleton nodes)
    if (!ctx._pendingFlatMap && ctx.fillMode && target.type === 'site') {
      if (typeof ctx._reloadMergedDraft === 'function') {
        await ctx._reloadMergedDraft();
      }
      if (!ctx._pendingFlatMap || typeof ctx._pendingFlatMap !== 'object') {
        throw new Error(
          'No AI draft loaded for this fill. The planner skeleton (signal_sections) may not be in the database yet — retry in a moment, or run the planner again.'
        );
      }
    }

    let { flat } = await fetchTarget(targetArgs);

    // Resolve parent node: slot (header/footer), section container, or page
    let parentNodeId;
    if (slotTarget && SLOT_MAP[slotTarget]) {
      parentNodeId = SLOT_MAP[slotTarget];
      if (!flat[parentNodeId]) {
        throw new Error(`Slot "${slotTarget}" (node "${parentNodeId}") not found. Is this a PageHub site/template?`);
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
        throw new Error(`Page "${pageId}" not found in site. Use list_pages to see available pages.`);
      }
    } else {
      parentNodeId = sectionContainerId;
      if (!flat[sectionContainerId] && ctx.fillMode && typeof ctx._reloadMergedDraft === 'function') {
        await ctx._reloadMergedDraft();
        ({ flat } = await fetchTarget(targetArgs));
      }
      if (!flat[sectionContainerId]) {
        throw new Error(
          `Section container "${sectionContainerId}" not found.${
            ctx.fillMode
              ? ' Use the section id from the planner (e.g. sec_hero). If you just ran signal_sections, retry once the draft has synced.'
              : ''
          }`
        );
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
      const searchTerms = rawSlug.replace(/[-_]+/g, ' ');
      const searchRes = await apiFetch(
        `/api/v1/components?q=${encodeURIComponent(searchTerms)}&limit=25`
      );
      const hits = searchRes.components || [];
      const lower = rawSlug.toLowerCase();
      const exact = hits.find((c) => c.slug === rawSlug || c.slug === lower);
      const ci = hits.find((c) => String(c.slug).toLowerCase() === lower);
      // Name-to-slug: model sees "Testimonial Card" and invents "testimonial-card"
      const slugFromName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const nameMatch = hits.find((c) => slugFromName(c.name) === lower);
      const lone = hits.length === 1 ? hits[0] : null;

      // Fuzzy: score by word overlap between invented slug and real slugs
      let fuzzy = null;
      if (!exact && !ci && !nameMatch && !lone && hits.length > 0) {
        const words = lower.replace(/[-_]+/g, ' ').split(/\s+/).filter(Boolean);
        let bestScore = 0;
        for (const c of hits) {
          const slugWords = c.slug.replace(/[-_]+/g, ' ').split(/\s+/);
          const nameWords = String(c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/);
          const allWords = new Set([...slugWords, ...nameWords]);
          const score = words.filter((w) => allWords.has(w)).length;
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
        throw new Error(
          `No kit block "${rawSlug}" (404). Do not invent slugs. Call search_blocks again, then apply_kit_block(slug) with the slug exactly as shown in backticks in the search results — or use the add_nodes fallback if nothing fits.`
        );
      }
      resolvedSlug = pick.slug;
      componentRes = await apiFetch(`/api/v1/components/${encodeURIComponent(resolvedSlug)}`);
    }

    const { component } = componentRes;
    if (!component?.structure) {
      throw new Error(`Block "${resolvedSlug}" has no structure.`);
    }

    // Track preset/style of applied blocks for cohesion hints in search_blocks
    if (component.preset || component.style) {
      if (!ctx._appliedBlockMeta) ctx._appliedBlockMeta = [];
      ctx._appliedBlockMeta.push({ preset: component.preset, style: component.style });
    }

    // For header/footer slots, keep the block's section wrapper intact (it's the slot's direct child).
    // For page sections, unwrap to avoid nesting two section shells.
    const structure = slotTarget ? component.structure : unwrapBlockStructure(component.structure);
    const co = parseMaybeJson(contentOverrides) || contentOverrides || {};
    const po = parseMaybeJson(propOverrides) || propOverrides || {};

    const sourceMeta = {
      type: 'block',
      block: resolvedSlug,
      ...(component.preset ? { preset: component.preset } : {}),
      ...(component.style ? { style: component.style } : {}),
      ...(component.version ? { version: component.version } : {}),
      appliedAt: new Date().toISOString(),
    };
    const { nodes: newNodes, rootId } = hierarchicalStructureToFlat(structure, parentNodeId, resolvedSlug, sourceMeta);
    walkApplyKitOverrides(newNodes, rootId, co, po);

    for (const [id, node] of Object.entries(newNodes)) {
      if (flat[id]) throw new Error(`Internal error: node id "${id}" already exists. Try a different block or report a bug.`);
      flat[id] = node;
    }

    const parentNodes = flat[parentNodeId].nodes || [];
    const position = args.position != null ? args.position : parentNodes.length;
    parentNodes.splice(position, 0, rootId);
    flat[parentNodeId].nodes = parentNodes;

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
      const summary =
        `Applied kit block "${component.name}" (\`${resolvedSlug}\`) — ${Object.keys(newNodes).length} nodes.${resolvedSlug !== rawSlug ? ` (resolved from "${rawSlug}")` : ''}\n\n${formatKitNodeIdManifest(newNodes, rootId, parentNodeId)}`;
      return {
        content: [{ type: 'text', text: summary }],
        pendingContent: ctx.fillMode ? ctx._pendingFlatMap : flat,
        changedNodes,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || 'https://pagehub.dev';
    const msg =
      target.type === 'template'
        ? `Applied kit block "${resolvedSlug}" to template "${result.id}".`
        : `Applied kit block "${resolvedSlug}".\nEditor: ${base}/build/${result.id}`;
    return { content: [{ type: 'text', text: msg }], changedNodes };
  },
};
