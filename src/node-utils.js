const { parseMaybeJson } = require("./helpers");

const VALID_COMPONENTS = new Set([
  "Accordion",
  "Audio",
  "Automatic",
  "Background",
  "Button",
  "ButtonList",
  "CartBadge",
  "CartDrawer",
  "CartItems",
  "CartSubtotal",
  "CheckoutBanner",
  "Container",
  "ContainerGroup",
  "Data",
  "Divider",
  "Dropdown",
  "Embed",
  "Footer",
  "Form",
  "FormElement",
  "Grid",
  "Header",
  "Icon",
  "Image",
  "ImageList",
  "Link",
  "List",
  "ListItem",
  "Table",
  "TableSection",
  "TableRow",
  "TableCell",
  "Map",
  "MapPoint",
  "Modal",
  "Nav",
  "ProductDisplay",
  "Spacer",
  "Tabs",
  "Text",
  "Video",
]);

const CANVAS_COMPONENTS = new Set([
  "Accordion",
  "Automatic",
  "CartDrawer",
  "CheckoutBanner",
  "Container",
  "ContainerGroup",
  "Data",
  "Dropdown",
  "Footer",
  "Header",
  "Nav",
  "Form",
  "Grid",
  "Background",
  "Modal",
  "Tabs",
  "ProductDisplay",
  "List",
  "Table",
  "TableSection",
  "TableRow",
]);

/** Collect a node and all its descendants from a flat map */
function collectSubtree(flat, nodeId) {
  const result = {};
  const walk = id => {
    if (!flat[id] || result[id]) return;
    result[id] = flat[id];
    for (const child of flat[id].nodes || []) walk(child);
  };
  walk(nodeId);
  return result;
}

/**
 * Sanitize AI-generated nodes into a valid CraftJS subtree.
 * - Parses string values
 * - Strips nodes with invalid/missing type.resolvedName
 * - Strips nodes that duplicate existing IDs in the flat map
 * - Rebuilds parent ↔ children relationships from the children (nodes) arrays
 * - Removes references to non-existent children
 * - Reparents orphans to the section container
 * - Ensures isCanvas, nodes[], linkedNodes{} on every node
 * Returns a clean map of only the new nodes (no existing/skeleton nodes).
 */
function sanitizeNodes(rawNodes, existingFlat, sectionContainerId) {
  const clean = {};

  // Step 1: Parse and validate — only keep nodes with valid component types
  for (const [id, rawNode] of Object.entries(rawNodes)) {
    if (id === sectionContainerId) continue; // never overwrite the container
    const node = typeof rawNode === "string" ? parseMaybeJson(rawNode) : rawNode;
    if (!node || typeof node !== "object") continue;
    if (!node.type?.resolvedName || !VALID_COMPONENTS.has(node.type.resolvedName)) continue;
    if (existingFlat[id]) continue; // don't overwrite existing nodes
    clean[id] = node;
  }

  if (Object.keys(clean).length === 0) return { nodes: {}, roots: [] };

  // Step 2: Ensure required fields on every node
  for (const [id, node] of Object.entries(clean)) {
    const isCanvas = CANVAS_COMPONENTS.has(node.type.resolvedName);
    node.isCanvas = isCanvas;
    if (!Array.isArray(node.nodes)) node.nodes = [];
    if (!node.linkedNodes || typeof node.linkedNodes !== "object") node.linkedNodes = {};
    if (node.hidden == null) node.hidden = false;
    if (!node.displayName) node.displayName = node.type.resolvedName;
    if (!node.custom) node.custom = {};
    if (!node.props) node.props = {};
    // className is the canonical styling prop; ensure it exists (may be empty string)
    if (node.props.className == null) node.props.className = "";

    // Strip class/className/style attributes from Text content — AI keeps adding them
    if (node.type.resolvedName === "Text" && node.props.root?.text) {
      node.props.root.text = node.props.root.text
        .replace(/\s*(class|className|style)="[^"]*"/gi, "")
        .replace(/<(p|div|h[1-6]|span)[^>]*>/gi, (match, tag) => `<${tag}>`)
        .trim();
    }
  }

  // Step 3: Remove children references that don't exist in clean or existingFlat
  const allIds = new Set([...Object.keys(clean), ...Object.keys(existingFlat)]);
  for (const node of Object.values(clean)) {
    node.nodes = node.nodes.filter(childId => allIds.has(childId));
  }

  // Step 4: Rebuild parent↔children from the DEEPEST claim
  // If multiple nodes claim the same child, the deepest (most nested) parent wins.
  // First pass: find all claims, last writer wins for parent assignment.
  const parentOf = {}; // childId → parentId
  for (const [id, node] of Object.entries(clean)) {
    for (const childId of node.nodes) {
      if (clean[childId]) {
        parentOf[childId] = id;
      }
    }
  }

  // Set parent refs
  for (const [childId, pid] of Object.entries(parentOf)) {
    clean[childId].parent = pid;
  }

  // Rebuild children arrays from parent refs (single source of truth)
  for (const node of Object.values(clean)) {
    node.nodes = [];
  }
  for (const [id, node] of Object.entries(clean)) {
    const pid = node.parent;
    if (pid && clean[pid]) {
      clean[pid].nodes.push(id);
    }
  }

  // Step 5: Reparent orphans (no parent in clean) to the section container
  const roots = [];
  for (const [id, node] of Object.entries(clean)) {
    if (!node.parent || !clean[node.parent]) {
      node.parent = sectionContainerId;
      roots.push(id);
    }
  }
  return { nodes: clean, roots };
}

/** Walk up to find the section root (type=section or child of page_home) */
function findSectionRoot(flat, nodeId) {
  let cur = nodeId;
  while (cur) {
    const n = flat[cur];
    if (!n) break;
    if (n.props?.type === "section" || n.parent === "page_home" || n.parent === "ROOT") return cur;
    if (!n.parent) break;
    cur = n.parent;
  }
  return nodeId;
}

module.exports = {
  VALID_COMPONENTS,
  CANVAS_COMPONENTS,
  collectSubtree,
  sanitizeNodes,
  findSectionRoot,
};
