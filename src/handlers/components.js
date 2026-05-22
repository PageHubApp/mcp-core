const { apiFetch } = require("../api-fetch");
const { getContext } = require("../context");
const {
  applyNodePatches,
  normalizeNodePatchArgs,
  normalizeBulkPatchesFromArgs,
  assertPatchBlockNodeArgs,
  assertPatchBlockBulkItem,
  mergeStrList,
  compressJsonToBase64Lz,
  decodeContentOrThrow,
  fetchTarget,
} = require("../helpers/index.js");
const {
  hierarchicalLibraryToFlat,
  flatLibraryToHierarchical,
  formatBlockNodeManifest,
} = require("../structure-ingest");
const { quickA11yAudit } = require("../a11y-check");

async function fetchComponents(params) {
  const qs = params.toString();
  return apiFetch(`/api/v1/components${qs ? `?${qs}` : ""}`);
}

async function fetchComponent(slug) {
  return apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
}

function decodeComponentStructure(component) {
  const decoded = decodeContentOrThrow(
    component?.structure,
    `Component "${component?.slug || "unknown"}" structure`
  );
  return { ...component, structure: decoded };
}

function encodeStructurePayload(structure) {
  if (typeof structure === "string" && structure) return structure;
  if (structure && typeof structure === "object") return compressJsonToBase64Lz(structure);
  throw new Error("structure must be an object or lzutf8+base64 compressed JSON string.");
}

/** Scan _pendingFlatMap for block slugs via custom.source metadata and kit_* node ID prefixes. */
function detectUsedBlockSlugs() {
  try {
    const ctx = getContext();
    const flat = ctx?._pendingFlatMap;
    if (!flat || typeof flat !== "object") return [];
    const slugSet = new Set();
    for (const [key, node] of Object.entries(flat)) {
      // Prefer explicit source metadata (stamped by apply_kit_block)
      const src = node?.custom?.source;
      if (src?.type === "block" && src.block) {
        slugSet.add(src.block);
        continue;
      }
      // Fallback: kit node IDs follow pattern: kit_<slug_with_underscores>_<hash>_n<N>
      const match = key.match(/^kit_(.+?)_[a-f0-9]{8}_n\d+$/);
      if (match) {
        slugSet.add(match[1].replace(/_/g, "-"));
      }
    }
    return [...slugSet];
  } catch {
    return [];
  }
}

/**
 * Walk a flat node map and surface page sections that are rich enough to adapt
 * (≥5 descendants, ≥2 distinct child component types). Skips the section the
 * current fill worker is filling — adapting itself is a no-op.
 *
 * Result is consumed by search_blocks to suggest `apply_kit_block({ sourceNodeId })`
 * as an alternative to stamping a fresh library block.
 */
function detectAdaptableSections(flat, currentSection) {
  try {
    if (!flat || typeof flat !== "object") return [];

    const candidates = [];
    for (const [id, node] of Object.entries(flat)) {
      if (!node || typeof node !== "object") continue;
      if (node.props?.type !== "section") continue;
      if (id === "hdr_root" || id === "ftr_root") continue;
      if (currentSection && id === currentSection) continue;
      const parent = node.parent ? flat[node.parent] : null;
      if (!parent || parent.props?.type !== "page") continue;

      let descendantCount = 0;
      const childTypes = new Set();
      const stack = [...(node.nodes || [])];
      while (stack.length) {
        const child = flat[stack.pop()];
        if (!child) continue;
        descendantCount++;
        const t = child.type?.resolvedName;
        if (t) childTypes.add(t);
        if (Array.isArray(child.nodes)) stack.push(...child.nodes);
      }
      if (descendantCount < 5 || childTypes.size < 2) continue;

      candidates.push({
        nodeId: id,
        displayName: node.custom?.displayName || "Section",
        blockSlug: node.custom?.source?.type === "block" ? node.custom.source.block : null,
        descendantCount,
        childTypes: [...childTypes].sort(),
      });
    }
    candidates.sort((a, b) => b.descendantCount - a.descendantCount);
    return candidates.slice(0, 8);
  } catch {
    return [];
  }
}

// Whitelist of valid args. Reject hallucinated keys (we've seen agents pass
// invented filters like `group: "acme-homepage-cards"` and then waste a tool
// call on the empty fallback). Better to fail fast with a "did you mean…"
// hint so the agent corrects on the next try.
const VALID_SEARCH_BLOCKS_KEYS = new Set([
  "q",
  "category",
  "categories",
  "subcategory",
  "tag",
  "preset",
  "source",
  "group",
  "style",
  "styles",
  "blockType",
  "featured",
  "sort",
  "page",
  "limit",
  // routing/internal opts the wrapper accepts but doesn't forward as filters
  "siteId",
  "templateSlug",
  "active",
]);

function nearestKey(invalid, valid) {
  const lower = String(invalid).toLowerCase();
  let best = null;
  let bestScore = Infinity;
  for (const v of valid) {
    const a = lower;
    const b = v.toLowerCase();
    // cheap edit-distance — Levenshtein
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    if (dp[a.length][b.length] < bestScore) {
      bestScore = dp[a.length][b.length];
      best = v;
    }
  }
  return bestScore <= Math.max(2, Math.floor(invalid.length / 3)) ? best : null;
}

module.exports = {
  async search_blocks(args) {
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
  },

  async get_block(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");

    const raw = await fetchComponent(slug);
    const c = decodeComponentStructure(raw.component || raw);

    return {
      content: [
        {
          type: "text",
          text: `# ${c.name} (\`${c.slug}\`)\n\n**Category:** ${c.category}${c.preset || c.source ? `\n**Preset:** ${c.preset || c.source}${c.source && !c.preset ? " (from legacy source field)" : ""}` : ""}${c.group ? `\n**Group:** ${c.group}` : ""}\n**Description:** ${c.description || ""}\n**Visual:** ${c.visual || ""}\n**Tags:** ${(c.tags || []).join(", ")}\n**Uses:** ${c.uses} · **Likes:** ${c.likes}\n\n**Patching:** Call \`list_block_nodes({ slug: "${c.slug}" })\` for deterministic \`lib_*\` node ids, then \`patch_block\` / \`patch_block_bulk\` (same patch fields as \`patch_site_node\`).\n\n## Structure\n\n\`\`\`json\n${JSON.stringify(c.structure, null, 2)}\n\`\`\``,
        },
      ],
    };
  },

  /**
   * Deterministic lib_* node id manifest for a library block (for patch_block / patch_block_bulk).
   */
  async list_block_nodes(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");

    const raw = await fetchComponent(slug);
    const c = decodeComponentStructure(raw.component || raw);

    const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
    const manifest = formatBlockNodeManifest(nodes, rootId, slug);

    return {
      content: [
        {
          type: "text",
          text: `# ${c.name} (\`${c.slug}\`)\n\n${manifest}\n\nPatch with the same \`slug\` you passed here (\`${slug}\`) so ids stay aligned.`,
        },
      ],
    };
  },

  async save_block(args) {
    const {
      name,
      slug,
      description,
      visual,
      category,
      subcategory,
      tags,
      preset,
      source,
      group,
      style,
      structure,
      isPublic,
      isCategoryPreview,
    } = args;
    if (!name || !slug || !category || !structure) {
      throw new Error("name, slug, category, and structure are required.");
    }

    const data = await apiFetch("/api/v1/components", {
      method: "POST",
      body: {
        name,
        slug,
        description,
        visual,
        category,
        subcategory,
        tags,
        preset,
        source,
        group,
        style,
        structure: encodeStructurePayload(structure),
        isPublic,
        isCategoryPreview,
      },
    });

    const auditInput = typeof structure === "string" ? null : structure;
    const audit = auditInput ? quickA11yAudit(auditInput) : null;
    const auditText = audit ? `\n\n---\n${audit.summary}` : "";
    return {
      content: [
        {
          type: "text",
          text: `Block saved: **${data.component.name}** (\`${data.component.slug}\`)\nPublic: ${data.component.isPublic}\nCategory: ${data.component.category}${auditText}`,
        },
      ],
    };
  },

  async update_block(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");
    const existing = await fetchComponent(slug);
    const existingComponent = existing.component || existing;
    const expectedVersion = Number(existingComponent?.version || 1);

    const body = {};
    const fields = [
      "name",
      "description",
      "visual",
      "category",
      "subcategory",
      "tags",
      "preset",
      "source",
      "group",
      "style",
      "structure",
      "isPublic",
      "isFeatured",
      "isCategoryPreview",
      "newSlug",
    ];
    for (const f of fields) {
      if (args[f] !== undefined) {
        body[f === "newSlug" ? "slug" : f] =
          f === "structure" ? encodeStructurePayload(args[f]) : args[f];
      }
    }

    if (Object.keys(body).length === 0) {
      throw new Error("Nothing to update. Provide at least one field.");
    }

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: { ...body, expectedVersion },
    });

    const c = data.component;
    const audit =
      args.structure && typeof args.structure === "object" ? quickA11yAudit(args.structure) : null;
    const auditText = audit ? `\n\n---\n${audit.summary}` : "";
    return {
      content: [
        {
          type: "text",
          text: `Block updated: **${c.name}** (\`${c.slug}\`)\nCategory: ${c.category}\nPublic: ${c.isPublic}${auditText}`,
        },
      ],
    };
  },

  async patch_block(args) {
    const { slug, nodeId } = args;
    if (!slug) throw new Error("slug is required.");
    if (!nodeId) throw new Error("nodeId is required.");
    assertPatchBlockNodeArgs(args);

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
    const c = decodeComponentStructure(data.component);

    const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
    const flat = JSON.parse(JSON.stringify(nodes));
    const { nodesPatch, unsetProps, unsetClasses } = args;
    applyNodePatches(
      flat,
      nodeId,
      normalizeNodePatchArgs({ ...args, nodesPatch, unsetProps, unsetClasses })
    );
    const newStructure = flatLibraryToHierarchical(flat, rootId);

    await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: {
        structure: encodeStructurePayload(newStructure),
        expectedVersion: Number(c.version || 1),
      },
    });

    return {
      content: [
        {
          type: "text",
          text: `Block \`${slug}\` patched (node \`${nodeId}\`). Structure saved. Re-run list_block_nodes if you renamed the slug.`,
        },
      ],
    };
  },

  async patch_block_bulk(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");

    const list = normalizeBulkPatchesFromArgs(args);
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(
        "patches must be a non-empty array of { nodeId, classNamePatch?, propsPatch?, ... } (same shape as patch_site_bulk)."
      );
    }

    const data = await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`);
    const c = decodeComponentStructure(data.component);

    const { nodes, rootId } = hierarchicalLibraryToFlat(c.structure, slug);
    const flat = JSON.parse(JSON.stringify(nodes));
    const touched = [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item.nodeId !== "string") {
        throw new Error(`patches[${i}]: missing nodeId`);
      }
      assertPatchBlockBulkItem(item, i);
      const { nodeId: nid, patches: _patches, ...rest } = item;
      applyNodePatches(flat, nid, normalizeNodePatchArgs(rest));
      touched.push(nid);
    }

    const newStructure = flatLibraryToHierarchical(flat, rootId);

    await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: {
        structure: encodeStructurePayload(newStructure),
        expectedVersion: Number(c.version || 1),
      },
    });

    return {
      content: [
        {
          type: "text",
          text: `Block \`${slug}\` patched (${touched.length} nodes): ${touched.join(", ")}. Structure saved.`,
        },
      ],
    };
  },

  async delete_block(args) {
    const { slug } = args;
    if (!slug) throw new Error("slug is required.");
    await apiFetch(`/api/v1/components/${encodeURIComponent(slug)}`, { method: "DELETE" });
    return { content: [{ type: "text", text: `Block "${slug}" deleted.` }] };
  },
};
