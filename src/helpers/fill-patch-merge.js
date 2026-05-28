/**
 * Merge `patch` into `ctx._fillPatch`, creating the bag on first use.
 *
 * `ctx._fillPatch` is the running collection of node id -> new node payload
 * that draft-mode tools accumulate and the host applies in a single fill-up
 * round-trip. Several handlers (kit apply, remote nodes, section-tree) hit the
 * same "init-if-missing + Object.assign" pattern; this collapses both lines
 * into one call.
 *
 * @param {object} ctx
 * @param {Record<string, any>} patch
 */
function recordFillPatch(ctx, patch) {
  if (!ctx._fillPatch) ctx._fillPatch = {};
  Object.assign(ctx._fillPatch, patch);
}

module.exports = { recordFillPatch };
