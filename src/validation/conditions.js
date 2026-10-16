/**
 * Shape check for condition groups — `props.conditionGroups` (visibility),
 * `stateModifiers[].conditions` and `action[].conditions`. The SDK evaluator
 * (packages/sdk/src/utils/conditions/evaluate.ts) reads `cond.key` with
 * `.split` / `.replace`, so a condition without a key throws and the React
 * viewer white-screens the whole page; an unknown type, operator or field
 * (`state: "logged_in"`) never matches and the node silently never shows.
 */

const TYPES = ["url-param", "form-field", "connector", "company", "device", "auth", "item", "localStorage", "state"];
const OPERATORS = ["equals", "not-equals", "contains", "not-contains", "exists", "not-exists", "greater-than", "less-than"];
const FIELDS = ["type", "key", "operator", "value", "target"];
const AUTH_STATUS = ["logged-in", "logged-out"];

const SHAPE_HINT =
  'Condition groups are [{ logic: "all" | "any", conditions: [{ type, key, operator, value }] }]. ' +
  'Signed-in gate: { type: "auth", key: "status", operator: "equals", value: "logged-in" }.';

/** @returns {string|null} error message, or null when the groups are valid */
function checkConditionGroups(groups, where) {
  if (groups == null) return null;
  if (!Array.isArray(groups)) return `${where} must be an array of condition groups. ${SHAPE_HINT}`;
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const at = `${where}[${g}]`;
    if (!group || typeof group !== "object" || Array.isArray(group)) return `${at} must be an object. ${SHAPE_HINT}`;
    if (group.logic != null && group.logic !== "all" && group.logic !== "any") {
      return `${at}.logic must be "all" or "any". ${SHAPE_HINT}`;
    }
    if (!Array.isArray(group.conditions)) return `${at}.conditions must be an array. ${SHAPE_HINT}`;
    for (let c = 0; c < group.conditions.length; c++) {
      const error = checkCondition(group.conditions[c], `${at}.conditions[${c}]`);
      if (error) return error;
    }
  }
  return null;
}

function checkCondition(cond, at) {
  if (!cond || typeof cond !== "object" || Array.isArray(cond)) return `${at} must be an object. ${SHAPE_HINT}`;
  const extra = Object.keys(cond).filter(k => !FIELDS.includes(k));
  if (extra.length) return `${at} has unsupported field(s) ${extra.map(k => `"${k}"`).join(", ")}. ${SHAPE_HINT}`;
  if (!TYPES.includes(cond.type)) return `${at}.type must be one of ${TYPES.join(", ")}. ${SHAPE_HINT}`;
  // `device` compares the viewport and ignores the key; every other type reads it.
  if (cond.type !== "device" && (typeof cond.key !== "string" || !cond.key)) {
    return `${at} (type "${cond.type}") needs a string \`key\`. ${SHAPE_HINT}`;
  }
  if (!OPERATORS.includes(cond.operator)) return `${at}.operator must be one of ${OPERATORS.join(", ")}. ${SHAPE_HINT}`;
  const needsValue = cond.operator !== "exists" && cond.operator !== "not-exists";
  if (needsValue && !["string", "number", "boolean"].includes(typeof cond.value)) {
    return `${at}.value is required for operator "${cond.operator}". ${SHAPE_HINT}`;
  }
  if (cond.type === "auth" && cond.key === "status" && needsValue && !AUTH_STATUS.includes(String(cond.value))) {
    return `${at}: auth status is "logged-in" or "logged-out", not "${cond.value}". ${SHAPE_HINT}`;
  }
  return null;
}

/** Every condition group a node's props carry: visibility, state modifiers, actions. */
function checkNodeConditions(props, nodeId) {
  if (!props || typeof props !== "object") return null;
  const where = `Node "${nodeId}"`;
  let error = checkConditionGroups(props.conditionGroups, `${where} conditionGroups`);
  if (error) return error;
  if (Array.isArray(props.stateModifiers)) {
    for (let i = 0; i < props.stateModifiers.length; i++) {
      error = checkConditionGroups(props.stateModifiers[i]?.conditions, `${where} stateModifiers[${i}].conditions`);
      if (error) return error;
    }
  }
  // Form nodes use `action` for the submission URL string.
  const actions = Array.isArray(props.action) ? props.action : props.action && typeof props.action === "object" ? [props.action] : [];
  for (let i = 0; i < actions.length; i++) {
    error = checkConditionGroups(actions[i]?.conditions, `${where} action[${i}].conditions`);
    if (error) return error;
  }
  return null;
}

/** Throws on invalid conditions in a props object or patch (patch_site_node / patch_site_bulk). */
function assertNodeConditions(props, nodeId) {
  const error = checkNodeConditions(props, nodeId);
  if (error) throw new Error(error);
}

/** `assertNodeConditions` over every node of a submitted map (add_nodes / insert_node). */
function assertNodeMapConditions(nodes) {
  for (const [id, node] of Object.entries(nodes || {})) {
    let props = node?.props;
    if (typeof props === "string") {
      try {
        props = JSON.parse(props);
      } catch {
        continue;
      }
    }
    assertNodeConditions(props, id);
  }
}

module.exports = { checkConditionGroups, checkNodeConditions, assertNodeConditions, assertNodeMapConditions };
