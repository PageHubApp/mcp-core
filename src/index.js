const tools = require('./tools.json');
const { runWithContext, getContext } = require('./context');
const { apiFetch, normalizeBaseUrl } = require('./api-fetch');
const {
  parseMaybeJson, applyNodePatches, normalizeNodePatchArgs,
  getActiveTarget, getActiveSiteId, isTemplateTarget,
  getEditorUrl, fetchTarget, fetchSite, saveTarget, saveSite,
  extractImageUrls, validateImageUrls, collectAllImageUrls,
} = require('./helpers');
const remoteHandlers = require('./handlers/remote');
const kitHandlers = require('./handlers/kit');
const componentHandlers = require('./handlers/components');
const portalHandlers = require('./handlers/portal');
const pageHandlers = require('./handlers/pages');
const nodeHandlers = require('./handlers/nodes');
const discoveryHandlers = require('./handlers/discovery');
const seoHandlers = require('./handlers/seo');
const aiHandlers = require('./handlers/ai');

// All HTTP handlers merged into a single dispatch map
const handlers = {
  ...remoteHandlers,
  ...kitHandlers,
  ...componentHandlers,
  ...portalHandlers,
  ...pageHandlers,
  ...nodeHandlers,
  ...discoveryHandlers,
  ...seoHandlers,
  ...aiHandlers,
};

// Tools that are HTTP-only (no filesystem / TemplateBuilder needed)
const HTTP_TOOL_NAMES = new Set(Object.keys(handlers));

// Tools excluded from the agent endpoint (auth handled per-request)
const AGENT_EXCLUDED = new Set(['register', 'save_as_section_template', 'save_component', 'update_component', 'delete_component', 'save_template', 'update_template', 'delete_template']);

/**
 * Get tool schemas for the agent endpoint.
 * Filters to HTTP-only tools and excludes auth tools.
 * Returns Claude API format (input_schema, not inputSchema).
 */
function getAgentTools() {
  return tools
    .filter(t => HTTP_TOOL_NAMES.has(t.name) && !AGENT_EXCLUDED.has(t.name))
    .map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

/**
 * Get all tool schemas (MCP format with inputSchema).
 */
function getAllTools() {
  return tools;
}

/**
 * Execute a tool by name within the current context.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @returns {Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }>}
 */
async function executeTool(name, args) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(args);
}

module.exports = {
  // Core
  runWithContext,
  getContext,
  apiFetch,
  normalizeBaseUrl,

  // Helpers
  parseMaybeJson,
  applyNodePatches,
  normalizeNodePatchArgs,
  getActiveTarget,
  getActiveSiteId,
  isTemplateTarget,
  getEditorUrl,
  fetchTarget,
  fetchSite,
  saveTarget,
  saveSite,
  extractImageUrls,
  validateImageUrls,
  collectAllImageUrls,

  // Tools
  getAllTools,
  getAgentTools,
  executeTool,
  handlers,

  // Constants
  HTTP_TOOL_NAMES,
  AGENT_EXCLUDED,
};
