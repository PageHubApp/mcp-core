/**
 * place_section_tree — atomic section fill for the clone pipeline.
 *
 * Model sends a NESTED hierarchy rooted at a Container; server flattens it to
 * CraftJS shape, generates stable ids, and replaces the section's children.
 *
 * This is a one-shot contract: no id bookkeeping across turns, no patch-before-add
 * sequencing, no stringified JSON ambiguity. If the model retries, the second
 * call replaces the first (idempotent).
 */

const { getContext, withPendingMapLock } = require("../core/context");
const { parseMaybeJson, getActiveTarget, fetchTarget, saveTarget } = require("../helpers/index.js");
const { recordFillPatch } = require("../helpers/fill-patch-merge");
const { VALID_COMPONENTS, CANVAS_COMPONENTS, collectSubtree } = require("../utils/node-utils");
const { validateNodes } = require("../validation/node-validation");
const { resultMsg } = require("./remote-shared");

function slugifyTypeForId(type) {
  return String(type || "node")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Try to parse a JSON string with targeted repairs for the most common
 * qwen3-coder tool-call malformation: a missing `{` before a sibling object
 * inside a children array — e.g. `}},"type":"Text"` where it should be
 * `}},{"type":"Text"`. Returns the parsed value, or null on unrecoverable input.
 */
function parseHierarchyString(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  // Repair pass: insert missing `{` after `}},` when the next char starts a key.
  // This matches the exact qwen3 failure mode seen on long hierarchies.
  const repaired = raw.replace(/(\}\s*\}\s*,\s*)("[A-Za-z_])/g, "$1{$2");
  if (repaired !== raw) {
    try {
      return JSON.parse(repaired);
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * Walk a nested hierarchy and produce a flat CraftJS-shape map.
 * Generates stable ids: `n_<type>_<sectionStem>_<counter>`.
 *
 * The `n_` prefix keeps these out of the `sec_` section-key namespace used by
 * logs and some helpers. The section stem prevents cross-section collisions
 * when finalize-build merges all section patches into one flat map.
 *
 * Model-supplied `id` fields are intentionally ignored — the model doesn't see
 * other sections' ids, so honoring model ids risks collision when two parallel
 * fills both generate the same descriptive id (e.g. "hero_headline"). The
 * model can look up the real ids via search_site_nodes if it needs to patch.
 */
function flattenHierarchy(hierarchy, sectionNodeId) {
  const flat = {};
  const idsInOrder = [];
  const counters = {};
  const sectionStem =
    String(sectionNodeId || "section")
      .replace(/^sec_/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "") || "section";

  function genId(type) {
    const stem = slugifyTypeForId(type);
    counters[stem] = (counters[stem] || 0) + 1;
    return `n_${stem}_${sectionStem}_${counters[stem]}`;
  }

  function walk(rawNode, parentId) {
    const node = typeof rawNode === "string" ? parseMaybeJson(rawNode) : rawNode;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error(
        `place_section_tree: every node in hierarchy must be an object; got ${typeof rawNode}.`
      );
    }
    const rawType = node.type;
    const type =
      typeof rawType === "string"
        ? rawType
        : rawType && typeof rawType === "object" && typeof rawType.resolvedName === "string"
          ? rawType.resolvedName
          : null;
    if (!type) {
      throw new Error(
        `place_section_tree: every node needs a "type" string (e.g. "Container", "Text", "Button"). Received: ${JSON.stringify(
          rawType
        ).slice(0, 120)}`
      );
    }
    if (!VALID_COMPONENTS.has(type)) {
      throw new Error(
        `place_section_tree: unknown component type "${type}". Allowed: ${[...VALID_COMPONENTS]
          .sort()
          .join(", ")}.`
      );
    }

    const id = genId(type);
    idsInOrder.push(id);

    const rawChildren = Array.isArray(node.children) ? node.children : [];
    const childIds = [];

    const rawProps =
      node.props && typeof node.props === "object" && !Array.isArray(node.props)
        ? { ...node.props }
        : {};
    // Model (qwen3) occasionally double-wraps: props: { className, props: { background, … } }.
    // Flatten one level of nested `props.props` so background / action / etc. land where
    // the renderer reads them. Outer keys win on collision — the inner is usually a typo.
    if (rawProps.props && typeof rawProps.props === "object" && !Array.isArray(rawProps.props)) {
      const inner = rawProps.props;
      delete rawProps.props;
      for (const [k, v] of Object.entries(inner)) {
        if (!(k in rawProps)) rawProps[k] = v;
      }
    }
    // Canonical id on props for editor bookkeeping (matches existing nodes).
    rawProps.id = id;
    if (rawProps.className == null) rawProps.className = "";
    if (!rawProps.custom || typeof rawProps.custom !== "object" || Array.isArray(rawProps.custom)) {
      rawProps.custom = {};
    }
    if (typeof rawProps.custom.displayName !== "string" || !rawProps.custom.displayName.trim()) {
      rawProps.custom.displayName = type;
    }
    if (typeof rawProps.canDelete !== "boolean") rawProps.canDelete = true;
    if (typeof rawProps.canEditName !== "boolean") rawProps.canEditName = true;

    flat[id] = {
      type: { resolvedName: type },
      isCanvas: CANVAS_COMPONENTS.has(type),
      props: rawProps,
      displayName: type,
      custom: rawProps.custom,
      parent: parentId,
      hidden: false,
      nodes: childIds,
      linkedNodes: {},
    };

    for (const child of rawChildren) {
      const childId = walk(child, id);
      childIds.push(childId);
    }
    flat[id].nodes = childIds;
    return id;
  }

  const rootId = walk(hierarchy, sectionNodeId);
  return { flat, rootId, idsInOrder };
}

module.exports = {
  async place_section_tree(args) {
    return withPendingMapLock(() => placeSectionTreeBody(args));
  },
};

async function placeSectionTreeBody(args) {
  const ctx = getContext();
  if (!ctx?.fillMode || !ctx.sectionNodeId) {
    throw new Error(
      "place_section_tree is only available in section-fill mode. The server sets sectionNodeId from the fill context — this tool cannot be called outside the clone pipeline."
    );
  }
  // Block after a kit has been stamped — otherwise this tool's idempotent
  // replace wipes the kit. If the model needs more children than the kit
  // provides, use add_nodes; if it picked the wrong kit, it should have
  // chosen differently up front.
  if (ctx._componentStructureReady) {
    throw new Error(
      "place_section_tree is disabled after structure has already been placed in this section (apply_kit_block or a prior place_section_tree succeeded). If the kit is missing elements, use add_nodes to append children — do NOT call place_section_tree again, it would wipe everything that's there."
    );
  }
  const sectionNodeId = String(ctx.sectionNodeId);
  const reason = typeof args?.reason === "string" ? args.reason.slice(0, 500) : "";

  let hierarchy = args?.hierarchy;
  // Model (qwen3-coder) sometimes stringifies `hierarchy`, and sometimes with
  // malformed JSON inside. Try strict parse, then a targeted repair, then a
  // clear error telling the model to send a native object.
  if (typeof hierarchy === "string") {
    const recovered = parseHierarchyString(hierarchy);
    if (recovered && typeof recovered === "object" && !Array.isArray(recovered)) {
      hierarchy = recovered;
    } else {
      throw new Error(
        "place_section_tree: hierarchy was sent as a STRING and failed to parse as JSON. " +
          "Send hierarchy as a NATIVE JSON OBJECT in the tool call — do NOT wrap it in quotes, do NOT stringify it. " +
          "The AI SDK encodes the tool arguments for you. Example: " +
          '{ "reason": "hero", "hierarchy": { "type": "Container", "props": {...}, "children": [...] } }  ' +
          "— note hierarchy is an object literal, not a quoted string."
      );
    }
  }
  if (!hierarchy || typeof hierarchy !== "object" || Array.isArray(hierarchy)) {
    throw new Error(
      "place_section_tree: `hierarchy` must be an object — the root Container for your section with nested `children`. Do not send a flat map, array, or string."
    );
  }
  const rootTypeRaw = hierarchy.type;
  const rootType =
    typeof rootTypeRaw === "string"
      ? rootTypeRaw
      : rootTypeRaw &&
          typeof rootTypeRaw === "object" &&
          typeof rootTypeRaw.resolvedName === "string"
        ? rootTypeRaw.resolvedName
        : null;
  if (rootType !== "Container") {
    throw new Error(
      `place_section_tree: hierarchy root must be a Container. Got "${rootType || "missing"}".`
    );
  }

  const target = getActiveTarget(args);
  // Fill mode for sites: reload merged draft so sec_* exists on flat.
  if (
    !ctx._pendingFlatMap &&
    target.type === "site" &&
    typeof ctx._reloadMergedDraft === "function"
  ) {
    await ctx._reloadMergedDraft();
  }
  const { flat } = await fetchTarget(args);
  if (!flat[sectionNodeId]) {
    throw new Error(
      `place_section_tree: section "${sectionNodeId}" not found in the current draft. The planner skeleton may not be synced — retry in a moment.`
    );
  }

  // Flatten hierarchy (throws on malformed nodes or unknown types).
  const { flat: newNodes, rootId, idsInOrder } = flattenHierarchy(hierarchy, sectionNodeId);

  // Auto-fix: wrap bare Text in <p>, apply heading tag defaults, dedupe tokens.
  // Same pass add_nodes runs (remote-nodes.js:206) — keeps rendered output clean
  // without forcing the model to micromanage HTML wrapping.
  validateNodes(newNodes, { autoFix: true, warnColors: true });

  // Idempotent replace: drop any existing subtrees under the section (including
  // from a previous place_section_tree call) before attaching the new root.
  // Collect stale ids first, then delete so _fillPatch can be scrubbed below.
  const staleIds = new Set();
  for (const childId of flat[sectionNodeId].nodes || []) {
    const subtree = collectSubtree(flat, childId);
    for (const id of Object.keys(subtree)) staleIds.add(id);
  }
  for (const id of staleIds) delete flat[id];

  // Merge new nodes into flat.
  for (const [id, node] of Object.entries(newNodes)) {
    flat[id] = node;
  }
  flat[sectionNodeId].nodes = [rootId];
  flat[rootId].parent = sectionNodeId;

  const changedNodes = {};
  Object.assign(changedNodes, collectSubtree(flat, sectionNodeId));

  // Draft mode path (clone pipeline runs here): stash into fill patch for persistence.
  if (ctx.draftMode) {
    // Strip EVERY stale id from the patch so shard-sync doesn't resurrect them.
    if (ctx._fillPatch) {
      for (const staleId of staleIds) {
        delete ctx._fillPatch[staleId];
      }
    }
    recordFillPatch(ctx, changedNodes);
    ctx._pendingFlatMap = flat;
    return {
      content: [
        {
          type: "text",
          text:
            `Section "${sectionNodeId}" placed: ${idsInOrder.length} nodes (root ${rootId}).` +
            (reason ? ` — ${reason}` : ""),
        },
      ],
      pendingContent: flat,
      changedNodes,
    };
  }

  const result = await saveTarget(target.id, target.type, flat);
  return {
    content: [
      {
        type: "text",
        text: resultMsg(
          result.id,
          target.type,
          `Section "${sectionNodeId}" placed: ${idsInOrder.length} nodes (root ${rootId}).`
        ),
      },
    ],
    changedNodes,
  };
}
