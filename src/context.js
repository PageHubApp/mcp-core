const { AsyncLocalStorage } = require("async_hooks");

/**
 * Per-request context via AsyncLocalStorage.
 * Stores apiKey, apiBaseUrl, activeSite, optional activePageNodeId (in-app agent only) — no global mutation.
 */
const requestContext = new AsyncLocalStorage();

/**
 * Run a function with per-request MCP context.
 * @param {{ apiKey: string, apiBaseUrl: string, activeSite?: { id: string }, activePageNodeId?: string }} ctx
 * @param {() => Promise<any>} fn
 */
function runWithContext(ctx, fn) {
  return requestContext.run(ctx, fn);
}

/** Get the current request context store (or empty object). */
function getContext() {
  return requestContext.getStore() || {};
}

/**
 * Serialize tool executions that mutate `ctx._pendingFlatMap` so concurrent
 * tool calls from the same assistant turn don't race.
 *
 * AI SDK fires every tool call returned in a single model response in parallel.
 * Each mutating handler does `flat = clone(ctx._pendingFlatMap)` → await I/O →
 * `ctx._pendingFlatMap = flat` (last-write-wins). With parallel `apply_kit_block`
 * calls (each ~200-3400ms on the component fetch), the slowest write wipes
 * every earlier kit's nodes from the map — see Yury's 2026-05-22 restaurant
 * demo where footer + CTA kits silently vanished.
 *
 * Wrapping the mutating section in this lock forces parallel writes to queue:
 * each waits for the prior holder, fetches the freshest pending map, mutates,
 * commits, then releases. No race window.
 */
async function withPendingMapLock(work) {
  const ctx = requestContext.getStore();
  if (!ctx) return await work();
  const prev = ctx._pendingMapLock || Promise.resolve();
  let release;
  const next = new Promise(resolve => {
    release = resolve;
  });
  ctx._pendingMapLock = prev.then(() => next);
  try {
    await prev;
    return await work();
  } finally {
    release();
  }
}

module.exports = { runWithContext, getContext, withPendingMapLock };
