/**
 * Mutate a flat CraftJS node map in place, applying a single patch.
 * All shape validation happens in patch/schema.js before reaching here;
 * this module is the pure mutator + per-call arg normalization.
 */

const { twMerge } = require("tailwind-merge");
const { parseMaybeJson, isSameChildIdMultiset, removeClasses } = require("../args");
const { normalizeTypePatch, CANVAS_TYPE_PATCH_COMPONENTS } = require("./schema");

/** Shallow-merge patch objects into a flat node map entry. */
function applyNodePatches(flatMap, nodeId, patchArgs) {
  const { typePatch, propsPatch, classNamePatch, nodesPatch, unsetProps, unsetClasses } =
    patchArgs;
  if (!flatMap[nodeId]) {
    let hint = "";
    if (String(nodeId).startsWith("kit_")) {
      const similar = Object.keys(flatMap)
        .filter(k => k.startsWith("kit_"))
        .slice(0, 12);
      hint =
        similar.length > 0
          ? ` Known kit_* ids in this map start with: ${similar.join(", ")}. Use ids from the apply_kit_block tool reply, not get_component_schema.`
          : " Use node ids from the latest apply_kit_block tool reply (copy exactly).";
    } else if (String(nodeId).startsWith("lib_")) {
      hint =
        " Use node ids from list_block_nodes for this block slug (copy exactly). Ids are deterministic from the slug.";
    }
    throw new Error(`Node ${nodeId} not found.${hint}`);
  }
  const entry = flatMap[nodeId];
  const p = entry.props;
  if (p == null || typeof p !== "object" || Array.isArray(p)) {
    entry.props = {};
  }
  // typePatch — update component type and keep isCanvas aligned with container semantics
  const normalizedTypePatch = normalizeTypePatch(typePatch);
  if (normalizedTypePatch) {
    entry.type = { ...(entry.type || {}), resolvedName: normalizedTypePatch };
    entry.isCanvas = CANVAS_TYPE_PATCH_COMPONENTS.has(normalizedTypePatch);
    if (!Array.isArray(entry.nodes)) entry.nodes = [];
  }
  // className patch — merge Tailwind classes into props.className via twMerge
  if (classNamePatch) {
    const existing = flatMap[nodeId].props.className || "";
    flatMap[nodeId].props.className = twMerge(existing, classNamePatch);
  }
  // Remove specific classes from props.className
  if (Array.isArray(unsetClasses) && unsetClasses.length > 0) {
    flatMap[nodeId].props.className = removeClasses(
      flatMap[nodeId].props.className || "",
      unsetClasses
    );
  }
  // propsPatch — shallow merge non-class props (text, src, href, alt, style, animation, etc.)
  // Deep-merge `root` to preserve existing keys (animation, pattern, activeModifiers, etc.)
  // Guard: propsPatch must be an object, never a string. A string here means parseMaybeJson
  // failed to parse malformed model JSON — spreading a string scatters chars as numeric keys.
  if (propsPatch && typeof propsPatch === "string") {
    throw new Error(
      `propsPatch for node "${nodeId}" is a string (invalid JSON from model). ` +
        `propsPatch must be a JSON object, not a string. Raw value starts with: ${propsPatch.substring(0, 120)}…`
    );
  }
  // Sanitize tagName to prevent corrupted data from crashing createElement
  if (propsPatch && typeof propsPatch.tagName === "string") {
    const t = propsPatch.tagName.split(/[,\s]/)[0].toLowerCase();
    if (/^[a-z][a-z0-6]*$/.test(t)) propsPatch.tagName = t;
    else delete propsPatch.tagName;
  }
  if (propsPatch) {
    // Deep-merge the typed nested namespaces so targeted updates
    // (e.g. propsPatch: { seo: { title: "X" } }) preserve sibling fields
    // on the existing object. Shallow-merge is fine for flat props.
    const DEEP_MERGE_KEYS = [
      "root",
      "background",
      "overflow",
      "seo",
      "design",
      "inject",
      "relation",
      "richText",
    ];
    const rest = { ...propsPatch };
    for (const key of DEEP_MERGE_KEYS) {
      if (rest[key] && typeof rest[key] === "object" && !Array.isArray(rest[key])) {
        flatMap[nodeId].props[key] = {
          ...(flatMap[nodeId].props[key] || {}),
          ...rest[key],
        };
        delete rest[key];
      }
    }
    flatMap[nodeId].props = { ...flatMap[nodeId].props, ...rest };
  }
  if (nodesPatch) {
    const prevNodes = flatMap[nodeId].nodes;
    if (!isSameChildIdMultiset(prevNodes, nodesPatch)) {
      const prevJson = JSON.stringify(prevNodes || []);
      const nextJson = JSON.stringify(nodesPatch);
      throw new Error(
        `nodesPatch must list the exact same child node ids as currently on "${nodeId}" (reorder only). ` +
          `Existing: ${prevJson}. Received: ${nextJson}. ` +
          `Do not use nodesPatch for design changes, "main areas", or partial lists — use classNamePatch and propsPatch. ` +
          `To add/remove sections use add_nodes / delete_node.`
      );
    }
    flatMap[nodeId].nodes = nodesPatch;
  }
  if (Array.isArray(unsetProps)) {
    for (const k of unsetProps) delete flatMap[nodeId].props[k];
  }
}

/** Normalize raw patch args (parse JSON strings). */
function normalizeNodePatchArgs(raw) {
  return {
    typePatch: parseMaybeJson(raw.typePatch) ?? raw.typePatch,
    propsPatch: parseMaybeJson(raw.propsPatch) ?? raw.propsPatch,
    classNamePatch: typeof raw.classNamePatch === "string" ? raw.classNamePatch : undefined,
    nodesPatch: raw.nodesPatch,
    unsetProps: raw.unsetProps,
    unsetClasses: raw.unsetClasses,
  };
}

module.exports = {
  applyNodePatches,
  normalizeNodePatchArgs,
};
