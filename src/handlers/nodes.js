const { getContext, withPendingMapLock } = require("../core/context");
const { ROOT_NODE_ID, PROTECTED_NODE_IDS } = require("../core/constants");

const {
  parseMaybeJson,
  fetchTarget,
  saveTarget,
  extractImageUrls,
  validateImageUrls,
  mergeBlockModifiersIntoRoot,
} = require("../helpers/index.js");
const { assertFillModePatchAllowed } = require("../helpers/fill-mode");
const { withTargetSaveOrDraft } = require("../helpers/load-mutate-save");

const { collectSubtree } = require("../utils/node-utils");
const { truncateLongProps, readPropPath } = require("../helpers/long-props");
const { assertNodeMapAnimations } = require("../validation/site-animations");
const { assertNodeMapStateModifiers } = require("../validation/state-modifiers");
const { assertNodeMapConditions } = require("../validation/conditions");

const PROTECTED_IDS = PROTECTED_NODE_IDS;
const MAX_CLASS_REGEX_LENGTH = 200;
// A group containing + or * that is itself followed by +, * or {n,}.
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)\s*(?:[+*]|\{\d*,)/;
// classNames are author-written; a regex only ever needs a class list's worth.
const MAX_CLASSNAME_SCAN = 4000;

module.exports = {
  async delete_node(args) {
    return withPendingMapLock(() => deleteNodeBody(args));
  },
  async insert_node(args) {
    return withPendingMapLock(() => insertNodeBody(args));
  },
  async move_node(args) {
    return withPendingMapLock(() => moveNodeBody(args));
  },
  // read-only handlers below are unwrapped — they don't touch ctx._pendingFlatMap
  list_site_nodes: listSiteNodesMethod,
  get_site_node: getSiteNodeMethod,
  search_site_nodes: searchSiteNodesMethod,
};

async function deleteNodeBody(args) {
  const { nodeId } = args;
  if (PROTECTED_IDS.includes(nodeId)) throw new Error(`Cannot delete structural node: ${nodeId}.`);
  return withTargetSaveOrDraft(
    args,
    async (flat, _target, ctx) => {
      if (!flat[nodeId]) throw new Error(`Node "${nodeId}" not found.`);
      assertFillModePatchAllowed(flat, nodeId, ctx);
      const parentId = flat[nodeId].parent;
      if (parentId && flat[parentId]) {
        flat[parentId].nodes = (flat[parentId].nodes || []).filter(id => id !== nodeId);
      }
      const deleteSubtree = id => {
        const node = flat[id];
        if (!node) return;
        for (const child of [...(node.nodes || [])]) deleteSubtree(child);
        delete flat[id];
      };
      deleteSubtree(nodeId);
    },
    (_mut, { draftMode, saveResult, target }) => {
      if (draftMode) {
        return { content: [{ type: "text", text: `Node "${nodeId}" and descendants deleted.` }] };
      }
      const label =
        target.type === "template"
          ? `Node "${nodeId}" and descendants deleted from template "${target.id}".`
          : `Node "${nodeId}" and descendants deleted.\nEditor: ${saveResult.url}`;
      return { content: [{ type: "text", text: label }] };
    }
  );
}

async function insertNodeBody(args) {
  const { nodeId, parentId, position, node } = args;
  if (typeof nodeId !== "string" || !nodeId.trim()) {
    // Models occasionally drop nodeId from the call; without this check we'd
    // write `flat[undefined] = ...` and push `undefined` into parent.nodes,
    // leaving a dangling child ref that crashes the editor with
    // "Cannot read properties of undefined (reading 'children')".
    throw new Error(
      'insert_node requires a non-empty string `nodeId` (e.g. "ftr_brand", "kit_my_block_n0"). Pass it explicitly.'
    );
  }
  if (typeof parentId !== "string" || !parentId.trim()) {
    throw new Error("insert_node requires a non-empty string `parentId`.");
  }
  const ctx = getContext();
  const { targetId, targetType, flat } = await fetchTarget(args);
  if (flat[nodeId]) throw new Error(`Node ID "${nodeId}" already exists. Use a unique ID.`);
  if (!flat[parentId]) throw new Error(`Parent node "${parentId}" not found.`);
  assertFillModePatchAllowed(flat, parentId, ctx);
  const nodeDef = parseMaybeJson(node) || node;
  const animationWarnings = assertNodeMapAnimations({ [nodeId]: nodeDef }, flat);
  assertNodeMapStateModifiers({ [nodeId]: nodeDef });
  assertNodeMapConditions({ [nodeId]: nodeDef });
  nodeDef.parent = parentId;
  if (!nodeDef.linkedNodes) nodeDef.linkedNodes = {};
  if (!nodeDef.nodes) nodeDef.nodes = [];
  if (!nodeDef.hidden) nodeDef.hidden = false;
  if (!nodeDef.displayName && nodeDef.type?.resolvedName)
    nodeDef.displayName = nodeDef.type.resolvedName;
  const imgUrls = extractImageUrls(nodeDef.props, nodeDef.type?.resolvedName);
  if (imgUrls.length > 0) {
    const failures = await validateImageUrls(imgUrls);
    if (failures.length > 0) {
      const msg = failures.map(f => `  ${f.url} → ${f.status}`).join("\n");
      throw new Error(
        `Image validation failed — these URLs are broken:\n${msg}\n\nFix the URLs and try again.`
      );
    }
  }
  flat[nodeId] = nodeDef;
  const list = flat[parentId].nodes || (flat[parentId].nodes = []);
  const pos = position != null ? position : list.length;
  list.splice(pos, 0, nodeId);
  mergeBlockModifiersIntoRoot(flat, parseMaybeJson(args.modifiers) || args.modifiers);
  const result = await saveTarget(targetId, targetType, flat);
  // collectSubtree(flat, parentId) includes the parent (with its updated
  // `nodes` list) plus the new subtree — matches the shape add_nodes /
  // patch_site_bulk return so the editor stream can hot-merge it.
  const changedNodes = collectSubtree(flat, parentId);
  const label =
    targetType === "template"
      ? `Node "${nodeId}" inserted into "${parentId}" at position ${pos} in template "${targetId}".`
      : `Node "${nodeId}" inserted into "${parentId}" at position ${pos}.\nEditor: ${result.url}`;
  const warnSuffix = animationWarnings.length
    ? `\n\nWarnings:\n${animationWarnings.map(w => `  - ${w}`).join("\n")}`
    : "";
  return { content: [{ type: "text", text: label + warnSuffix }], changedNodes };
}

// Above this many nodes, a whole-site listing ends with a hint to scope it by page.
const LIST_NODES_SCOPE_HINT_AT = 200;

function isHeaderOrFooter(node) {
  const resolved = node?.type?.resolvedName;
  const t = node?.props?.type;
  return resolved === "Header" || resolved === "Footer" || t === "header" || t === "footer";
}

/**
 * Lightweight node tree — id, component type, displayName, short text, child count.
 * Whole site by default. `pageId` lists one subtree in full and folds the rest:
 * header / footer to their direct children, other pages to one line each.
 * `depth` caps how many levels below the starting node are expanded.
 */
async function listSiteNodesMethod(args) {
  const { flat } = await fetchTarget(args);
  const total = Object.keys(flat).length;
  const requested = typeof args.pageId === "string" ? args.pageId.trim() : "";
  const pageId = requested && requested !== ROOT_NODE_ID ? requested : null;
  const maxDepth =
    args.depth != null && Number.isFinite(Number(args.depth)) && Number(args.depth) >= 0
      ? Math.floor(Number(args.depth))
      : Infinity;
  if (pageId && !flat[pageId]) {
    throw new Error(`Node "${pageId}" not found. Page ids come from list_pages.`);
  }

  const lines = [];
  let shown = 0;
  const line = (id, indentLevel, folded) => {
    const node = flat[id];
    const type = node.type?.resolvedName || "?";
    const label = node.custom?.displayName || "";
    const childCount = (node.nodes || []).length;
    const text = node.props?.text
      ? ` text="${String(node.props.text)
          .replace(/<[^>]*>/g, "")
          .substring(0, 40)}"`
      : "";
    const fold = folded && childCount > 0 ? ", folded" : "";
    lines.push(
      `${"  ".repeat(indentLevel)}${id} | ${type}${label ? ` "${label}"` : ""}${text} (${childCount} children${fold})`
    );
    shown++;
  };
  // `levels` = how many levels below `id` to expand.
  const visit = (id, indentLevel, levels) => {
    if (!flat[id]) return;
    const kids = flat[id].nodes || [];
    line(id, indentLevel, levels <= 0);
    if (levels <= 0) return;
    for (const childId of kids) visit(childId, indentLevel + 1, levels - 1);
  };

  let heading;
  if (!pageId) {
    visit(ROOT_NODE_ID, 0, maxDepth);
    heading = `Site node tree (${total} nodes)`;
  } else {
    // Path from ROOT down to the requested node, so its place stays visible.
    const path = [];
    for (let cur = pageId; cur && flat[cur]; cur = flat[cur].parent) path.unshift(cur);
    const rootChildOnPath = path[1];
    if (path[0] !== ROOT_NODE_ID) visit(pageId, 0, maxDepth); // detached from ROOT
    else line(ROOT_NODE_ID, 0, false);
    for (const childId of path[0] === ROOT_NODE_ID ? flat[ROOT_NODE_ID].nodes || [] : []) {
      if (!flat[childId]) continue;
      if (childId === pageId) visit(childId, 1, maxDepth);
      else if (childId === rootChildOnPath) {
        // pageId sits deeper: walk the ancestors one line each, then expand it.
        let level = 1;
        for (const anc of path.slice(1, -1)) line(anc, level++, false);
        visit(pageId, level, maxDepth);
      } else if (isHeaderOrFooter(flat[childId])) visit(childId, 1, 1);
      else line(childId, 1, true);
    }
    heading = `Site node tree (${total} nodes; showing ${pageId}${Number.isFinite(maxDepth) ? ` to depth ${maxDepth}` : ""}, header/footer top level, other pages folded — ${shown} lines)`;
  }

  const hint =
    !pageId && total > LIST_NODES_SCOPE_HINT_AT
      ? `\n\n(${total} nodes. Pass pageId (from list_pages) to list one page, or depth to fold deep levels.)`
      : "";
  return {
    content: [{ type: "text", text: `${heading}:\n\n${lines.join("\n")}${hint}` }],
  };
}

/**
 * Search site nodes by displayName pattern or component type.
 * Returns matching node IDs with their displayName, type, className, and parent.
 */
async function moveNodeBody(args) {
  const { nodeId, newParentId, position } = args;
  if (PROTECTED_IDS.includes(nodeId)) throw new Error(`Cannot move structural node: ${nodeId}.`);
  const ctx = getContext();
  const { targetId, targetType, flat } = await fetchTarget(args);
  if (!flat[nodeId]) throw new Error(`Node "${nodeId}" not found.`);
  if (!flat[newParentId]) throw new Error(`New parent "${newParentId}" not found.`);
  assertFillModePatchAllowed(flat, nodeId, ctx);
  assertFillModePatchAllowed(flat, newParentId, ctx);

  const oldParentId = flat[nodeId].parent;
  if (!oldParentId || !flat[oldParentId])
    throw new Error(`Node "${nodeId}" has no valid parent — cannot move.`);
  if (oldParentId === newParentId && position == null) {
    return {
      content: [
        {
          type: "text",
          text: `Node "${nodeId}" is already a child of "${newParentId}". Nothing to do.`,
        },
      ],
    };
  }

  // Prevent moving a node into its own subtree
  let ancestor = newParentId;
  while (ancestor) {
    if (ancestor === nodeId)
      throw new Error(`Cannot move "${nodeId}" into its own subtree (circular reference).`);
    ancestor = flat[ancestor]?.parent || null;
  }

  // Remove from old parent
  flat[oldParentId].nodes = (flat[oldParentId].nodes || []).filter(id => id !== nodeId);

  // Insert into new parent
  const list = flat[newParentId].nodes || (flat[newParentId].nodes = []);
  const pos = position != null ? position : list.length;
  list.splice(pos, 0, nodeId);

  // Update node's parent ref
  flat[nodeId].parent = newParentId;

  if (ctx.draftMode) {
    ctx._pendingFlatMap = flat;
    return {
      content: [
        {
          type: "text",
          text: `Node "${nodeId}" moved from "${oldParentId}" to "${newParentId}" at position ${pos}.`,
        },
      ],
    };
  }
  const result = await saveTarget(targetId, targetType, flat);
  const label =
    targetType === "template"
      ? `Node "${nodeId}" moved from "${oldParentId}" to "${newParentId}" at position ${pos} in template "${targetId}".`
      : `Node "${nodeId}" moved from "${oldParentId}" to "${newParentId}" at position ${pos}.\nEditor: ${result.url}`;
  return { content: [{ type: "text", text: label }] };
}

/**
 * Read one node's payload (type, props, className, nodes, parent, custom).
 * String props over LONG_PROP_CHARS (ROOT `inject.head` CSS, Embed `code`, …)
 * come back as a short head plus a note; `prop: "inject.head"` returns that one
 * value whole, `full: true` returns every prop whole. Required before patching
 * a string-valued nested prop you don't want to overwrite.
 */
async function getSiteNodeMethod(args) {
  const { nodeId, prop } = args;
  if (!nodeId) throw new Error("nodeId is required.");
  const { flat } = await fetchTarget(args);
  const node = flat[nodeId];
  if (!node) throw new Error(`Node "${nodeId}" not found.`);
  if (typeof prop === "string" && prop.trim()) {
    const path = prop.trim().replace(/^props\./, "");
    const value = readPropPath(node.props || {}, path);
    if (value === undefined) throw new Error(`Node "${nodeId}" has no prop "${path}".`);
    return {
      content: [
        { type: "text", text: JSON.stringify({ id: nodeId, prop: path, value }, null, 2) },
      ],
    };
  }
  const full = args.full === true || args.full === "true";
  const { props, truncated } = full
    ? { props: node.props || {}, truncated: [] }
    : truncateLongProps(node.props || {});
  const payload = {
    id: nodeId,
    type: node.type,
    isCanvas: node.isCanvas,
    parent: node.parent,
    nodes: node.nodes || [],
    custom: node.custom || {},
    props,
    ...(truncated.length
      ? { truncatedProps: truncated.map(t => `${t.path} (${t.length} chars)`) }
      : {}),
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function searchSiteNodesMethod(args) {
  const { q, type: componentType, className, classRegex } = args;
  const { flat } = await fetchTarget(args);

  if (!q && !componentType && !className && !classRegex) {
    throw new Error(
      "At least one of q, type, className, or classRegex is required. e.g. q (displayName/text/id substring), type (component type like Text/Button/Container), className (substring match), or classRegex (regex match)."
    );
  }

  const qLower = q ? q.toLowerCase() : null;
  const typeLower = componentType ? componentType.toLowerCase() : null;
  const classLower = className ? className.toLowerCase() : null;
  let classRe = null;
  if (classRegex) {
    // The pattern and the classNames it runs on are both caller-written, and this
    // runs on the shared hosted server: refuse long patterns and nested
    // quantifiers like `(a+)+`, the shape that backtracks exponentially.
    if (String(classRegex).length > MAX_CLASS_REGEX_LENGTH) {
      throw new Error(`classRegex is too long (max ${MAX_CLASS_REGEX_LENGTH} characters).`);
    }
    if (NESTED_QUANTIFIER.test(String(classRegex))) {
      throw new Error("classRegex can't repeat a group that already repeats, e.g. (a+)+.");
    }
    try {
      classRe = new RegExp(classRegex, "i");
    } catch (e) {
      throw new Error(`Invalid classRegex: ${e.message}.`);
    }
  }
  const classFiltered = Boolean(classLower || classRe);
  const matches = [];

  for (const [id, node] of Object.entries(flat)) {
    const nodeType = node.type?.resolvedName || "";
    const displayName = node.custom?.displayName || "";
    const text = node.props?.text || "";
    const classNameStr = node.props?.className || "";

    let match = true;
    if (qLower) {
      match =
        displayName.toLowerCase().includes(qLower) ||
        text.toLowerCase().includes(qLower) ||
        id.toLowerCase().includes(qLower);
    }
    if (typeLower && match) {
      match = nodeType.toLowerCase() === typeLower;
    }
    if (classLower && match) {
      match = classNameStr.toLowerCase().includes(classLower);
    }
    if (classRe && match) {
      match = classRe.test(String(classNameStr).slice(0, MAX_CLASSNAME_SCAN));
    }
    if (match) {
      matches.push({
        id,
        type: nodeType,
        displayName,
        className: classFiltered ? classNameStr : classNameStr.substring(0, 80),
        parent: node.parent || "",
        text: text.replace(/<[^>]*>/g, "").substring(0, 50),
      });
    }
  }

  if (matches.length === 0) {
    const filterStr = [
      q && `q="${q}"`,
      componentType && `type="${componentType}"`,
      className && `className="${className}"`,
      classRegex && `classRegex="${classRegex}"`,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      content: [{ type: "text", text: `No nodes matched ${filterStr}.` }],
    };
  }

  const lines = matches.map(
    m =>
      `${m.id} | ${m.type}${m.displayName ? ` "${m.displayName}"` : ""}${m.text ? ` text="${m.text}"` : ""}\n  className: ${m.className || "(none)"}\n  parent: ${m.parent}`
  );

  return {
    content: [
      {
        type: "text",
        text: `Found ${matches.length} node(s):\n\n${lines.join("\n\n")}`,
      },
    ],
  };
}
