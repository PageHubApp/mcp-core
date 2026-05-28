const {
  parseMaybeJson,
  fetchTarget,
  saveTarget,
  extractImageUrls,
  validateImageUrls,
  mergeBlockModifiersIntoRoot,
} = require("../helpers/index.js");
const { getContext, withPendingMapLock } = require("../core/context");
const { assertFillModePatchAllowed } = require("../helpers/fill-mode");
const { withTargetSaveOrDraft } = require("../helpers/load-mutate-save");
const { collectSubtree } = require("../utils/node-utils");

const PROTECTED_IDS = ["ROOT", "page_home"];

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
  return { content: [{ type: "text", text: label }], changedNodes };
}

/**
 * Lightweight node summary — returns ID, displayName, component type, parent, children count.
 * ~2KB instead of 100KB+ from pull_site. Use this instead of pull_site for navigation/inspection.
 */
async function listSiteNodesMethod(args) {
  const { flat } = await fetchTarget(args);

  // Build DFS tree from ROOT
  const lines = [];
  const visit = (id, depth) => {
    const node = flat[id];
    if (!node) return;
    const type = node.type?.resolvedName || "?";
    const label = node.custom?.displayName || "";
    const childCount = (node.nodes || []).length;
    const indent = "  ".repeat(depth);
    const text = node.props?.text
      ? ` text="${String(node.props.text)
          .replace(/<[^>]*>/g, "")
          .substring(0, 40)}"`
      : "";
    lines.push(
      `${indent}${id} | ${type}${label ? ` "${label}"` : ""}${text} (${childCount} children)`
    );
    for (const childId of node.nodes || []) visit(childId, depth + 1);
  };

  // Start from ROOT → hdr_root, page_home, ftr_root
  visit("ROOT", 0);

  return {
    content: [
      {
        type: "text",
        text: `Site node tree (${Object.keys(flat).length} nodes):\n\n${lines.join("\n")}`,
      },
    ],
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
 * Read one node's full payload (type, props, className, nodes, parent, custom).
 * Use this to inspect `props.inject.head` / `props.inject.footer` on ROOT, or any
 * other field that doesn't surface in `list_site_nodes` / `search_site_nodes`.
 * Required before patching a string-valued nested prop you don't want to overwrite.
 */
async function getSiteNodeMethod(args) {
  const { nodeId } = args;
  if (!nodeId) throw new Error("nodeId is required.");
  const { flat } = await fetchTarget(args);
  const node = flat[nodeId];
  if (!node) throw new Error(`Node "${nodeId}" not found.`);
  const payload = {
    id: nodeId,
    type: node.type,
    isCanvas: node.isCanvas,
    parent: node.parent,
    nodes: node.nodes || [],
    custom: node.custom || {},
    props: node.props || {},
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
      "Provide q (displayName/text/id search), type (component type like Text, Button, Container), className (substring match), or classRegex (regex match)."
    );
  }

  const qLower = q ? q.toLowerCase() : null;
  const typeLower = componentType ? componentType.toLowerCase() : null;
  const classLower = className ? className.toLowerCase() : null;
  let classRe = null;
  if (classRegex) {
    try {
      classRe = new RegExp(classRegex, "i");
    } catch (e) {
      throw new Error(`Invalid classRegex: ${e.message}`);
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
      match = classRe.test(classNameStr);
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
