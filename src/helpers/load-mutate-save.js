/**
 * `withTargetSaveOrDraft` — wraps the fetch-mutate-(save | stash) cycle every
 * handler does after touching `flat`.
 *
 * Usage:
 *   return withTargetSaveOrDraft(args, async (flat, target, ctx) => {
 *     // mutate flat in place; return arbitrary `mutationResult`
 *     flat[id].props.foo = "bar";
 *     return { changedIds: [id] };
 *   }, (mutationResult, { flat, ctx, draftMode, saveResult, target }) => {
 *     // build the MCP tool response. `saveResult` is the saveTarget() return
 *     // when persisting, undefined in draft mode.
 *     return { content: [{ type: "text", text: "ok" }] };
 *   });
 *
 * Most callers in this codebase have extra logic between fetch and save
 * (validation, multi-stage mutation, fillMode recording) that doesn't fit the
 * straight-through shape; those are intentionally left alone.
 */

const { getContext } = require("../core/context");
const { fetchTarget, saveTarget, getActiveTarget } = require("./index.js");

async function withTargetSaveOrDraft(args, mutator, formatResult) {
  const ctx = getContext();
  const target = getActiveTarget(args);
  const fetched = await fetchTarget(args);
  const { flat } = fetched;
  const mutationResult = await mutator(flat, target, ctx);
  if (ctx.draftMode) {
    ctx._pendingFlatMap = flat;
    return formatResult(mutationResult, {
      flat,
      ctx,
      draftMode: true,
      saveResult: undefined,
      target,
    });
  }
  const saveResult = await saveTarget(target.id, target.type, flat);
  return formatResult(mutationResult, {
    flat,
    ctx,
    draftMode: false,
    saveResult,
    target,
  });
}

module.exports = { withTargetSaveOrDraft };
