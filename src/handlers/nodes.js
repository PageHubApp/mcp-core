const {
  parseMaybeJson,
  applyNodePatches,
  fetchTarget,
  saveTarget,
  extractImageUrls,
  validateImageUrls,
} = require("../helpers");
const { getContext } = require("../context");

const PROTECTED_IDS = ["ROOT", "page_home"];

module.exports = {
  async update_node(args) {
    const { nodeId, ...patches } = args;
    const { targetId, targetType, flat } = await fetchTarget(args);
    const patchedProps = patches.propsPatch ? parseMaybeJson(patches.propsPatch) : {};
    const imgUrls = [];
    if (
      patchedProps?.content &&
      typeof patchedProps.content === "string" &&
      patchedProps.content.startsWith("http")
    ) {
      imgUrls.push(patchedProps.content);
    }
    if (
      patchedProps?.backgroundImage &&
      typeof patchedProps.backgroundImage === "string" &&
      patchedProps.backgroundImage.startsWith("http")
    ) {
      imgUrls.push(patchedProps.backgroundImage);
    }
    if (imgUrls.length > 0) {
      const failures = await validateImageUrls(imgUrls);
      if (failures.length > 0) {
        const msg = failures.map(f => `  ${f.url} → ${f.status}`).join("\n");
        throw new Error(
          `Image validation failed — these URLs are broken:\n${msg}\n\nFix the URLs and try again.`
        );
      }
    }
    applyNodePatches(flat, nodeId, patches);
    const result = await saveTarget(targetId, targetType, flat);
    const label =
      targetType === "template"
        ? `Node ${nodeId} updated in template "${targetId}".`
        : `Node ${nodeId} updated.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
  },

  async delete_node(args) {
    const { nodeId } = args;
    if (PROTECTED_IDS.includes(nodeId))
      throw new Error(`Cannot delete structural node: ${nodeId}.`);
    const ctx = getContext();
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat[nodeId]) throw new Error(`Node "${nodeId}" not found.`);
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
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return { content: [{ type: "text", text: `Node "${nodeId}" and descendants deleted.` }] };
    }
    const result = await saveTarget(targetId, targetType, flat);
    const label =
      targetType === "template"
        ? `Node "${nodeId}" and descendants deleted from template "${targetId}".`
        : `Node "${nodeId}" and descendants deleted.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
  },

  async insert_node(args) {
    const { nodeId, parentId, position, node } = args;
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (flat[nodeId]) throw new Error(`Node ID "${nodeId}" already exists. Use a unique ID.`);
    if (!flat[parentId]) throw new Error(`Parent node "${parentId}" not found.`);
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
    const result = await saveTarget(targetId, targetType, flat);
    const label =
      targetType === "template"
        ? `Node "${nodeId}" inserted into "${parentId}" at position ${pos} in template "${targetId}".`
        : `Node "${nodeId}" inserted into "${parentId}" at position ${pos}.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
  },

  /**
   * Lightweight node summary — returns ID, displayName, component type, parent, children count.
   * ~2KB instead of 100KB+ from pull_site. Use this instead of pull_site for navigation/inspection.
   */
  async list_site_nodes(args) {
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
        ? ` text="${String(node.props.text).replace(/<[^>]*>/g, "").substring(0, 40)}"`
        : "";
      lines.push(`${indent}${id} | ${type}${label ? ` "${label}"` : ""}${text} (${childCount} children)`);
      for (const childId of node.nodes || []) visit(childId, depth + 1);
    };

    // Start from ROOT → hdr_root, page_home, ftr_root
    visit("ROOT", 0);

    return {
      content: [{
        type: "text",
        text: `Site node tree (${Object.keys(flat).length} nodes):\n\n${lines.join("\n")}`,
      }],
    };
  },

  /**
   * Search site nodes by displayName pattern or component type.
   * Returns matching node IDs with their displayName, type, className, and parent.
   */
  async move_node(args) {
    const { nodeId, newParentId, position } = args;
    if (PROTECTED_IDS.includes(nodeId))
      throw new Error(`Cannot move structural node: ${nodeId}.`);
    const ctx = getContext();
    const { targetId, targetType, flat } = await fetchTarget(args);
    if (!flat[nodeId]) throw new Error(`Node "${nodeId}" not found.`);
    if (!flat[newParentId]) throw new Error(`New parent "${newParentId}" not found.`);

    const oldParentId = flat[nodeId].parent;
    if (!oldParentId || !flat[oldParentId])
      throw new Error(`Node "${nodeId}" has no valid parent — cannot move.`);
    if (oldParentId === newParentId && position == null) {
      return { content: [{ type: "text", text: `Node "${nodeId}" is already a child of "${newParentId}". Nothing to do.` }] };
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
      return { content: [{ type: "text", text: `Node "${nodeId}" moved from "${oldParentId}" to "${newParentId}" at position ${pos}.` }] };
    }
    const result = await saveTarget(targetId, targetType, flat);
    const label =
      targetType === "template"
        ? `Node "${nodeId}" moved from "${oldParentId}" to "${newParentId}" at position ${pos} in template "${targetId}".`
        : `Node "${nodeId}" moved from "${oldParentId}" to "${newParentId}" at position ${pos}.\nEditor: ${result.url}`;
    return { content: [{ type: "text", text: label }] };
  },

  async search_site_nodes(args) {
    const { q, type: componentType } = args;
    const { flat } = await fetchTarget(args);

    if (!q && !componentType) {
      throw new Error("Provide q (displayName search) and/or type (component type like Text, Button, Container).");
    }

    const qLower = q ? q.toLowerCase() : null;
    const typeLower = componentType ? componentType.toLowerCase() : null;
    const matches = [];

    for (const [id, node] of Object.entries(flat)) {
      const nodeType = node.type?.resolvedName || "";
      const displayName = node.custom?.displayName || "";
      const text = node.props?.text || "";

      let match = true;
      if (qLower) {
        match = displayName.toLowerCase().includes(qLower) ||
                text.toLowerCase().includes(qLower) ||
                id.toLowerCase().includes(qLower);
      }
      if (typeLower && match) {
        match = nodeType.toLowerCase() === typeLower;
      }
      if (match) {
        matches.push({
          id,
          type: nodeType,
          displayName,
          className: (node.props?.className || "").substring(0, 80),
          parent: node.parent || "",
          text: text.replace(/<[^>]*>/g, "").substring(0, 50),
        });
      }
    }

    if (matches.length === 0) {
      return { content: [{ type: "text", text: `No nodes matched${q ? ` q="${q}"` : ""}${componentType ? ` type="${componentType}"` : ""}.` }] };
    }

    const lines = matches.map(m =>
      `${m.id} | ${m.type}${m.displayName ? ` "${m.displayName}"` : ""}${m.text ? ` text="${m.text}"` : ""}\n  className: ${m.className || "(none)"}\n  parent: ${m.parent}`
    );

    return {
      content: [{
        type: "text",
        text: `Found ${matches.length} node(s):\n\n${lines.join("\n\n")}`,
      }],
    };
  },
};
