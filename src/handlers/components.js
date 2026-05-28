const { getContext } = require("../core/context");
const { mergeStrList, fetchTarget } = require("../helpers/index.js");
const { fetchComponents } = require("./components/api");
const { detectUsedBlockSlugs, detectAdaptableSections } = require("./components/discovery");
const { VALID_SEARCH_BLOCKS_KEYS, nearestKey } = require("./components/arg-validation");
const blockCrud = require("./components/block-crud");

async function search_blocks(args) {
  const ctx = getContext();

  if (args && typeof args === "object" && !Array.isArray(args)) {
    const invalid = Object.keys(args).filter(k => !VALID_SEARCH_BLOCKS_KEYS.has(k));
    if (invalid.length) {
      const hints = invalid
        .map(k => {
          const near = nearestKey(k, [...VALID_SEARCH_BLOCKS_KEYS]);
          return near ? `"${k}" — did you mean "${near}"?` : `"${k}"`;
        })
        .join("; ");
      return {
        content: [
          {
            type: "text",
            text:
              `Error: search_blocks received unknown filter key(s): ${hints}.\n\n` +
              `Valid keys: ${[...VALID_SEARCH_BLOCKS_KEYS].sort().join(", ")}.\n` +
              `Drop the unknown key(s) and retry — do NOT add a fake group/tag/preset just to narrow results.`,
          },
        ],
      };
    }
  }

  let categories = mergeStrList(args.category, args.categories);
  let styles = mergeStrList(args.style, args.styles);
  // Auto-inject buildStyle as a hard filter when present on context
  if (ctx.buildStyle && styles.length === 0 && !args.preset) {
    styles = [ctx.buildStyle];
  }

  const params = new URLSearchParams();
  if (args.q) params.set("q", args.q);
  if (categories.length === 1) params.set("category", categories[0]);
  else if (categories.length > 1) params.set("category", categories.join(","));
  if (args.subcategory) params.set("subcategory", args.subcategory);
  if (args.tag) params.set("tag", args.tag);
  if (args.preset) params.set("preset", args.preset);
  if (args.source) params.set("source", args.source);
  if (args.group) params.set("group", args.group);
  if (styles.length === 1) params.set("style", styles[0]);
  else if (styles.length > 1) params.set("style", styles.join(","));
  if (args.blockType) params.set("blockType", args.blockType);
  if (args.featured) params.set("featured", "true");
  if (args.sort) {
    params.set("sort", args.sort);
  } else if (args.q) {
    // Match layout intent (split, photo, form card, …) via Mongo textScore — not usage rank.
    params.set("sort", "relevance");
  } else {
    // Category-only browse: avoid defaulting every hero to the same top-uses slug.
    params.set("sort", "newest");
  }
  if (args.page) params.set("page", String(args.page));
  if (args.limit) params.set("limit", String(args.limit));

  let data = await fetchComponents(params);
  let { components, total, page, pages } = data;
  let broadened = false;
  let styleWidened = false;
  let subcategoryDropped = false;
  let genericFallback = false;

  // Fallback 1: drop text query `q` if it returned zero hits
  if (!components.length && args.q) {
    const wide = new URLSearchParams(params);
    wide.delete("q");
    const data2 = await fetchComponents(wide);
    if (data2.components?.length) {
      data = data2;
      components = data2.components;
      total = data2.total;
      page = data2.page;
      pages = data2.pages;
      broadened = true;
    }
  }

  // Fallback 2: drop style filter if buildStyle narrowed to zero (show universal blocks)
  if (!components.length && ctx.buildStyle && params.has("style")) {
    const wide = new URLSearchParams(params);
    wide.delete("style");
    if (args.q) wide.delete("q");
    const data2 = await fetchComponents(wide);
    if (data2.components?.length) {
      data = data2;
      components = data2.components;
      total = data2.total;
      page = data2.page;
      pages = data2.pages;
      styleWidened = true;
    }
  }

  // Fallback 3: drop subcategory — model often picks a subcategory with no indexed blocks
  if (!components.length && (args.subcategory || params.has("subcategory"))) {
    const wide = new URLSearchParams(params);
    wide.delete("subcategory");
    const data2 = await fetchComponents(wide);
    if (data2.components?.length) {
      data = data2;
      components = data2.components;
      total = data2.total;
      page = data2.page;
      pages = data2.pages;
      subcategoryDropped = true;
    }
  }

  // Fallback 4: last resort — recent public blocks library-wide (never leave the agent empty-handed)
  if (!components.length) {
    const last = new URLSearchParams();
    last.set("limit", "24");
    last.set("sort", "newest");
    const data2 = await fetchComponents(last);
    if (data2.components?.length) {
      data = data2;
      components = data2.components;
      total = data2.total;
      page = data2.page;
      pages = data2.pages;
      genericFallback = true;
    }
  }

  if (!components.length) {
    return {
      content: [
        {
          type: "text",
          text: "No blocks found and the library returned no public components. Check that the component library is populated.",
        },
      ],
    };
  }

  const lines = components.map(c => {
    const catLabel = c.subcategory ? `${c.category}/${c.subcategory}` : c.category;
    const stylesLabel =
      Array.isArray(c.styles) && c.styles.length
        ? `styles:${c.styles.join("/")}`
        : c.style
          ? `style:${c.style}`
          : null;
    const meta = [catLabel, c.preset && `preset:${c.preset}`, stylesLabel]
      .filter(Boolean)
      .join(", ");
    let line = `• \`${c.slug}\` — ${c.name} (${meta})`;
    let detail = c.description || c.visual || "";
    if (c.description && c.visual && String(c.visual).trim() !== String(c.description).trim()) {
      detail = `${c.description}\n  Visual: ${c.visual}`;
    }
    line += `\n  ${detail}`;
    if ((c.tags || []).length) line += `\n  Tags: ${c.tags.join(", ")}`;
    return line;
  });

  const pageCount = pages != null ? pages : 1;
  const pageNum = page != null ? page : 1;
  const totalCount = total != null ? total : components.length;
  const paginationNote =
    pageCount > 1
      ? `**More exist:** ${totalCount} total — this is **page ${pageNum} of ${pageCount}**. Call \`search_blocks\` again with the same filters and \`page: ${pageNum + 1}\` (etc.) to see more. For a full category slug list in one shot, use \`list_blocks({ category: "…" })\` (planner only).\n\n`
      : totalCount > components.length
        ? `**Note:** ${totalCount} total matches; this response lists ${components.length}. If you need more breadth, raise \`limit\` (max 100) or use \`list_blocks\`.\n\n`
        : "";

  let widenedNote = "";
  if (genericFallback) {
    widenedNote = `**Fallback — not an exact match:** Nothing matched the previous filters (text search, category, style, or subcategory may be too narrow or the index has no hits for those terms). Below are **recent** public blocks from the **whole library** (not usage-ranked). Pick the closest \`slug\` for the section type you need and **rewrite copy** in patches for the user’s topic — do not keep searching in a loop.\n\n`;
  } else if (subcategoryDropped) {
    widenedNote = `*(Subcategory widened: no blocks under that subcategory — showing the rest of this category.)*\n\n`;
  } else if (styleWidened) {
    widenedNote = `*(Style widened: no \`${ctx.buildStyle}\` blocks for this category — showing universal blocks.)*\n\n`;
  } else if (broadened) {
    widenedNote = `*(Search widened: dropped text query \`q\` because it returned no hits — prefer category/tag alone next time.)*\n\n`;
  }

  // Warn when no buildStyle is set — the agent is picking blocks before the
  // theme has been locked, so style filter does nothing and results skew to
  // generic defaults. Only warn in chat-build mode (not fill — fills receive
  // ctx.buildStyle from the parent planner).
  const noStyleWarn =
    !ctx.buildStyle && !ctx.fillMode
      ? `*(No buildStyle on context — call \`set_theme({ preset })\` BEFORE search_blocks so results are filtered to the theme's visual family. Picking blocks now means defaults instead of style-matched picks.)*\n\n`
      : "";
  const head = `# Blocks (${totalCount} total, page ${pageNum}/${pageCount})${ctx.buildStyle ? ` [style: ${ctx.buildStyle}]` : ""}\n\n${noStyleWarn}${widenedNote}${paginationNote}`;

  // Warn about blocks already used on this page to encourage variety
  const usedSlugs = detectUsedBlockSlugs();
  const usedNote =
    usedSlugs.length > 0
      ? `\n\nAlready used on this page: ${usedSlugs.map(s => `\`${s}\``).join(", ")}. Pick a DIFFERENT block for variety.`
      : "";

  // Surface rich existing sections as adaptable alternatives. The agent can
  // pass sourceNodeId to apply_kit_block to clone an on-site section instead
  // of stamping a fresh library block — cheaper and keeps the page coherent.
  // Auto-load the site if the agent hasn't touched it yet — logs show
  // fill workers + chat-mode "add a section" calls hit search_blocks cold,
  // so without this the adaptable list would always be empty on the first
  // tool call. Failures are swallowed (no target id, missing draft, etc.) —
  // search_blocks must still return library results in those cases.
  let siteFlat = ctx?._pendingFlatMap;
  if (!siteFlat) {
    try {
      if (ctx?.fillMode && typeof ctx._reloadMergedDraft === "function") {
        await ctx._reloadMergedDraft();
        siteFlat = ctx?._pendingFlatMap;
      } else {
        const fetched = await fetchTarget(args);
        siteFlat = fetched?.flat;
      }
    } catch {
      siteFlat = null;
    }
  }
  const adaptable = detectAdaptableSections(siteFlat, ctx?.sectionNodeId);
  const adaptableNote = adaptable.length
    ? `\n\n## Reusable from this site\nAdapt an existing section — pass \`sourceNodeId\` to apply_kit_block (instead of \`slug\`). The subtree is cloned with fresh ids; use contentOverrides to rewrite copy in one shot.\n\n${adaptable
        .map(
          a =>
            `• \`${a.nodeId}\` — ${a.displayName}${a.blockSlug ? ` (from \`${a.blockSlug}\`)` : ""}, ${a.descendantCount} nodes [${a.childTypes.slice(0, 6).join(", ")}]`
        )
        .join("\n")}`
    : "";

  return {
    content: [
      {
        type: "text",
        text: `${head}${lines.join("\n\n")}\n\nPass a \`slug\` to apply_kit_block. Do NOT modify or invent slugs.${usedNote}${adaptableNote}`,
      },
    ],
  };
}

module.exports = {
  ...blockCrud,
  search_blocks,
};
