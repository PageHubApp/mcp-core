const { normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");

/** Format result message with editor URL (sites) or slug (templates). */
function resultMsg(targetId, targetType, msg) {
  if (targetType === "template") return `Template "${targetId}": ${msg}`;
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
  return `${msg}\nEditor: ${base}/build/${targetId}`;
}

module.exports = { resultMsg };
