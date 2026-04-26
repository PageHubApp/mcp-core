const { getContext } = require("../context");
const {
  parseMaybeJson,
  getActiveTarget,
  fetchTarget,
  saveTarget,
  assertInjectHtml,
} = require("../helpers");
const { normalizeBaseUrl } = require("../api-fetch");
const { buildPatch } = require("../helpers/patch/build");

/** Find all page nodes — direct ROOT children with props.type === 'page'. */
function findPages(flat) {
  const root = flat.ROOT;
  if (!root) return [];
  const pages = [];
  for (const childId of root.nodes || []) {
    const node = flat[childId];
    if (node && node.props?.type === "page") {
      pages.push({ id: childId, node });
    }
  }
  return pages;
}

/** Slugify a display name to a URL path (simple lowercase + hyphens). */
function toSlug(name) {
  return (name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = {
  async list_pages(args) {
    const { targetId, targetType, flat } = await fetchTarget(args);
    const pages = findPages(flat);

    if (pages.length === 0) {
      return { content: [{ type: "text", text: `No pages found in this ${targetType}.` }] };
    }

    const lines = pages.map((p, i) => {
      const props = p.node.props || {};
      const name = p.node.custom?.displayName || p.node.displayName || "(unnamed)";
      const slug = toSlug(name);
      const flags = [];
      if (props.isHomePage) flags.push("HOME");
      if (props.is404Page) flags.push("404");
      if (props.isHidden || p.node.hidden) flags.push("HIDDEN");
      const sectionCount = (p.node.nodes || []).length;
      const flagStr = flags.length ? ` [${flags.join(", ")}]` : "";
      return `${i + 1}. **${p.id}** — "${name}" (/${slug}, ${sectionCount} sections)${flagStr}`;
    });

    const label = targetType === "template" ? `template "${targetId}"` : `site ${targetId}`;
    return {
      content: [
        {
          type: "text",
          text: `# Pages in ${label}\n\n${lines.join("\n")}\n\nUse pageId with add_section, add_custom_section, or update_page.`,
        },
      ],
    };
  },

  async add_page(args) {
    const { name, isHomePage, is404Page, position } = args;
    if (!name) throw new Error("Page name is required.");

    const target = getActiveTarget(args);
    const { flat } = await fetchTarget(args);
    const root = flat.ROOT;
    if (!root) throw new Error("No ROOT node found.");

    const prevRootChildren = Array.isArray(root.nodes) ? root.nodes.slice() : [];
    const touched = new Set();

    const pages = findPages(flat);
    const slug = toSlug(name);
    const pageId = `page_${slug.replace(/-/g, "_")}`;
    if (flat[pageId])
      throw new Error(`Node ID "${pageId}" already exists. Choose a different page name.`);

    // Build SEO props from args. Accept the legacy flat keys (pageTitle, pageDescription, …)
    // on the `seo` arg for back-compat, but store under the canonical seo.* shape on the node.
    const seo = parseMaybeJson(args.seo) || {};
    const keyMap = {
      pageTitle: "title",
      pageDescription: "description",
      pageKeywords: "keywords",
      ogTitle: "ogTitle",
      ogDescription: "ogDescription",
      ogImage: "ogImage",
      ogType: "ogType",
      canonicalUrl: "canonicalUrl",
      robots: "robots",
    };
    const seoNested = {};
    for (const [flatKey, nestedKey] of Object.entries(keyMap)) {
      const value = seo[flatKey] != null ? seo[flatKey] : seo[nestedKey];
      if (value != null) seoNested[nestedKey] = value;
    }
    const seoProps = Object.keys(seoNested).length ? { seo: seoNested } : {};

    // Determine home page flag
    const shouldBeHome = isHomePage === true || pages.length === 0;

    // If this becomes home page, unset the flag on the current one
    if (shouldBeHome) {
      for (const p of pages) {
        if (p.node.props?.isHomePage) {
          p.node.props.isHomePage = false;
          touched.add(p.id);
        }
      }
    }

    // Create the page node
    flat[pageId] = {
      type: { resolvedName: "Container" },
      isCanvas: true,
      props: {
        canDelete: true,
        canEditName: true,
        type: "page",
        className: "flex flex-col w-full",
        ...(shouldBeHome ? { isHomePage: true } : {}),
        ...(is404Page === true ? { is404Page: true } : {}),
        ...seoProps,
      },
      displayName: "Container",
      custom: { displayName: name },
      parent: "ROOT",
      hidden: false,
      nodes: [],
      linkedNodes: {},
    };

    // Insert into ROOT.nodes — before footer if no explicit position
    const rootNodes = root.nodes || (root.nodes = []);
    let insertPos;
    if (position != null) {
      insertPos = position;
    } else {
      let lastPageIdx = -1;
      for (let i = 0; i < rootNodes.length; i++) {
        const n = flat[rootNodes[i]];
        if (n && n.props?.type === "page") lastPageIdx = i;
      }
      insertPos = lastPageIdx >= 0 ? lastPageIdx + 1 : rootNodes.length;
    }
    rootNodes.splice(insertPos, 0, pageId);
    touched.add(pageId);

    const ctx = getContext();

    const patch = buildPatch(flat, touched, prevRootChildren);

    // Support batched mode (agent endpoint)
    if (ctx._batchMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [
          {
            type: "text",
            text: `Page "${name}" created as ${pageId} (/${slug}). To add blocks: apply_kit_block(slug, pageId: "${pageId}") — do NOT pass sectionContainerId.`,
          },
        ],
        pendingContent: flat,
        patch,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    const homeMsg = shouldBeHome ? " Marked as home page." : "";
    if (target.type === "template") {
      return {
        content: [
          {
            type: "text",
            text: `Page "${name}" created as ${pageId} (/${slug}) in template "${target.id}".${homeMsg} To add blocks: apply_kit_block(slug, pageId: "${pageId}") — do NOT pass sectionContainerId.`,
          },
        ],
        patch,
      };
    }
    const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
    return {
      content: [
        {
          type: "text",
          text: `Page "${name}" created as ${pageId} (/${slug}).${homeMsg} To add blocks: apply_kit_block(slug, pageId: "${pageId}") — do NOT pass sectionContainerId.\nEditor: ${base}/build/${result.id}`,
        },
      ],
      patch,
    };
  },

  async update_page(args) {
    const { pageId, name, isHomePage, is404Page, isHidden } = args;
    if (!pageId) throw new Error("pageId is required.");

    const target = getActiveTarget(args);
    const ctx = getContext();

    const { flat } = await fetchTarget(args);

    const page = flat[pageId];
    if (!page) throw new Error(`Page node "${pageId}" not found.`);
    if (page.props?.type !== "page")
      throw new Error(`Node "${pageId}" is not a page (type: ${page.props?.type || "unknown"}).`);

    const touched = new Set();
    const changes = [];

    if (name != null) {
      if (!page.custom) page.custom = {};
      page.custom.displayName = name;
      changes.push(`name → "${name}" (/${toSlug(name)})`);
    }

    if (isHomePage === true) {
      const pages = findPages(flat);
      for (const p of pages) {
        if (p.node.props?.isHomePage) {
          p.node.props.isHomePage = false;
          touched.add(p.id);
        }
      }
      page.props.isHomePage = true;
      changes.push("isHomePage → true");
    } else if (isHomePage === false) {
      page.props.isHomePage = false;
      changes.push("isHomePage → false");
    }

    if (is404Page != null) {
      page.props.is404Page = is404Page;
      changes.push(`is404Page → ${is404Page}`);
    }

    if (isHidden != null) {
      page.props.isHidden = isHidden;
      page.hidden = isHidden;
      changes.push(`isHidden → ${isHidden}`);
    }

    const seo = parseMaybeJson(args.seo) || {};
    const seoKeyMap = {
      pageTitle: "title",
      pageDescription: "description",
      pageKeywords: "keywords",
      ogTitle: "ogTitle",
      ogDescription: "ogDescription",
      ogImage: "ogImage",
      ogType: "ogType",
      canonicalUrl: "canonicalUrl",
      robots: "robots",
    };
    for (const [flatKey, nestedKey] of Object.entries(seoKeyMap)) {
      const value = seo[flatKey] != null ? seo[flatKey] : seo[nestedKey];
      if (value != null) {
        if (!page.props.seo) page.props.seo = {};
        page.props.seo[nestedKey] = value;
        changes.push(`seo.${nestedKey} → "${value}"`);
      }
    }

    for (const key of ["headCode", "bodyClass"]) {
      if (args[key] != null) {
        const val = String(args[key]);
        if (val === "") {
          delete page.props[key];
          changes.push(`${key} → (cleared)`);
        } else {
          if (key === "headCode") {
            assertInjectHtml(val, `update_page.headCode for page "${page.props?.name || pageId}"`);
          }
          page.props[key] = val;
          const preview = val.length > 40 ? val.slice(0, 40) + "…" : val;
          changes.push(`${key} → "${preview}"`);
        }
      }
    }

    if (changes.length === 0) {
      return { content: [{ type: "text", text: "No changes specified." }] };
    }

    touched.add(pageId);
    const patch = buildPatch(flat, touched);

    // Draft mode: persist into _pendingFlatMap so signal_sections picks up SEO changes
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [{ type: "text", text: `Page ${pageId} updated:\n  ${changes.join("\n  ")}` }],
        patch,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    const label = target.type === "template" ? `template "${target.id}"` : `site`;
    const editorLine =
      target.type === "site"
        ? `\nEditor: ${normalizeBaseUrl(getContext().apiBaseUrl) || "https://pagehub.dev"}/build/${result.id}`
        : "";
    return {
      content: [
        {
          type: "text",
          text: `Page ${pageId} updated in ${label}:\n  ${changes.join("\n  ")}${editorLine}`,
        },
      ],
      patch,
    };
  },

  async delete_page(args) {
    const { pageId } = args;
    if (!pageId) throw new Error("pageId is required.");

    const target = getActiveTarget(args);
    const { flat } = await fetchTarget(args);

    const page = flat[pageId];
    if (!page) throw new Error(`Page node "${pageId}" not found.`);
    if (page.props?.type !== "page")
      throw new Error(`Node "${pageId}" is not a page (type: ${page.props?.type || "unknown"}).`);

    const pages = findPages(flat);
    if (pages.length <= 1)
      throw new Error(`Cannot delete the last page. A ${target.type} must have at least one page.`);

    const wasHomePage = page.props?.isHomePage === true;
    const pageName = page.custom?.displayName || page.displayName || pageId;

    const root = flat.ROOT;
    const prevRootChildren = root && Array.isArray(root.nodes) ? root.nodes.slice() : [];
    if (root) {
      root.nodes = (root.nodes || []).filter(id => id !== pageId);
    }

    const deletedIds = [];
    const deleteSubtree = id => {
      const n = flat[id];
      if (!n) return;
      for (const child of [...(n.nodes || [])]) deleteSubtree(child);
      delete flat[id];
      deletedIds.push(id);
    };
    deleteSubtree(pageId);

    const touched = new Set();
    let promotedPage = null;
    if (wasHomePage) {
      const remaining = findPages(flat);
      if (remaining.length > 0) {
        remaining[0].node.props.isHomePage = true;
        promotedPage = remaining[0].id;
        touched.add(promotedPage);
      }
    }

    const patch = buildPatch(flat, touched, prevRootChildren, deletedIds);

    const result = await saveTarget(target.id, target.type, flat);
    const promoMsg = promotedPage ? ` ${promotedPage} promoted to home page.` : "";
    if (target.type === "template") {
      return {
        content: [
          {
            type: "text",
            text: `Page "${pageName}" (${pageId}) deleted from template "${target.id}".${promoMsg}`,
          },
        ],
        patch,
      };
    }
    const base = normalizeBaseUrl(getContext().apiBaseUrl) || "https://pagehub.dev";
    return {
      content: [
        {
          type: "text",
          text: `Page "${pageName}" (${pageId}) deleted.${promoMsg}\nEditor: ${base}/build/${result.id}`,
        },
      ],
      patch,
    };
  },
};
