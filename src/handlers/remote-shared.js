const { normalizeBaseUrl } = require("../core/api-fetch");
const { getContext } = require("../core/context");

/**
 * Format result message with editor URL (sites) or slug (templates).
 *
 * Appends the staged/live state for sites. Site writes go into the DRAFT and
 * `publish_site` promotes them, so a message that just says "Updated" reads as
 * "this is live" and an agent stops before the step that actually publishes.
 *
 * Read from context rather than threaded through ~20 call sites: the staged
 * state is a property of the site after the write, not of any one message, and
 * `saveTarget` is the single seam every write passes through — so no caller can
 * forget to report it.
 */
function resultMsg(targetId, targetType, msg) {
  if (targetType === "template") return `Template "${targetId}": ${msg}`;
  const ctx = getContext();
  const base = normalizeBaseUrl(ctx.apiBaseUrl) || "https://pagehub.dev";
  let out = `${msg}\nEditor: ${base}/build/${targetId}`;

  const write = ctx._lastSiteWrite;
  if (write && String(write.id) === String(targetId) && write.wroteTo === "draft") {
    out += write.hasUnpublishedChanges
      ? "\nSaved to DRAFT — the published site still shows the previous version. Run publish_site to go live."
      : "\nSaved to DRAFT (site is not published).";
  }
  return out;
}

module.exports = { resultMsg };
