const { normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");

/**
 * Format result message with editor URL (sites) or slug (templates).
 *
 * The staged/live state is NOT appended here. Only a handful of the ~16 write
 * handlers route their message through this helper; the rest build their own
 * text, so a trailer added here reached some responses and not others. It now
 * comes from `executeTool`, which every tool passes through — see
 * `helpers/publish-state.js`.
 */
function resultMsg(targetId, targetType, msg) {
  if (targetType === "template") return `Template "${targetId}": ${msg}`;
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
  return `${msg}\nEditor: ${base}/build/${targetId}`;
}

module.exports = { resultMsg };
