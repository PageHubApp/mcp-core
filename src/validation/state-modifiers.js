/**
 * Shape check for `props.stateModifiers`. Both renderers only read
 * `{ conditions, modifiers: [names] }` and resolve each name against the
 * component's built-in modifiers plus ROOT.props.modifiers[<Component>]; any
 * other field (inline `classes`, a single `modifier` string) is dropped without
 * a trace, so the node renders unstyled. Reject it with the supported shape.
 */

const SHAPE_HINT =
  'Each stateModifiers entry is { conditions: [ConditionGroup], modifiers: ["name", ...] }. ' +
  "For one-off classes, register a named modifier first (add_nodes `modifiers: { Button: " +
  '[{ name: "pot-sage", classes: "bg-(--pot-sage)" }] }`, or patch ROOT.props.modifiers) ' +
  "and list its name in `modifiers`.";

/** @returns {string|null} error message, or null when the bindings are valid */
function checkStateModifiers(bindings, nodeId) {
  if (bindings == null) return null;
  const where = `Node "${nodeId}" stateModifiers`;
  if (!Array.isArray(bindings)) return `${where} must be an array. ${SHAPE_HINT}`;
  for (let i = 0; i < bindings.length; i++) {
    const b = bindings[i];
    const at = `${where}[${i}]`;
    if (!b || typeof b !== "object" || Array.isArray(b)) return `${at} must be an object. ${SHAPE_HINT}`;
    const extra = Object.keys(b).filter(k => k !== "conditions" && k !== "modifiers");
    if (extra.length) return `${at} has unsupported field(s) ${extra.map(k => `"${k}"`).join(", ")}. ${SHAPE_HINT}`;
    if (!Array.isArray(b.conditions)) return `${at}.conditions must be an array of condition groups. ${SHAPE_HINT}`;
    const names = b.modifiers;
    if (!Array.isArray(names) || !names.length || names.some(n => typeof n !== "string" || !n)) {
      return `${at}.modifiers must be a non-empty array of modifier names. ${SHAPE_HINT}`;
    }
  }
  return null;
}

/** Throws on an invalid `stateModifiers` value (patch_site_node / patch_site_bulk). */
function assertStateModifiers(bindings, nodeId) {
  const error = checkStateModifiers(bindings, nodeId);
  if (error) throw new Error(error);
}

/** `assertStateModifiers` over every node of a submitted map (add_nodes / insert_node). */
function assertNodeMapStateModifiers(nodes) {
  for (const [id, node] of Object.entries(nodes || {})) {
    let props = node?.props;
    if (typeof props === "string") {
      try {
        props = JSON.parse(props);
      } catch {
        continue;
      }
    }
    if (props && "stateModifiers" in props) assertStateModifiers(props.stateModifiers, id);
  }
}

module.exports = { checkStateModifiers, assertStateModifiers, assertNodeMapStateModifiers };
