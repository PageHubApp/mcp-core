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

module.exports = { runWithContext, getContext };
