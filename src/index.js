const tools = require("./tools.json");
const {
  isPlaceholderCompanyName,
  userExplicitlyRequestsBrandingChange,
  guardRootCompanyPropsPatch,
} = require("./branding-guard");
const { runWithContext, getContext } = require("./context");
const { apiFetch, normalizeBaseUrl } = require("./api-fetch");
const {
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
} = require("./helpers");
const remoteHandlers = require("./handlers/remote");
const kitHandlers = require("./handlers/kit");
const componentHandlers = require("./handlers/components");
const portalHandlers = require("./handlers/portal");
const pageHandlers = require("./handlers/pages");
const nodeHandlers = require("./handlers/nodes");
const siteConfigHandlers = require("./handlers/site-config");
const discoveryHandlers = require("./handlers/discovery");
const seoHandlers = require("./handlers/seo");
const stockImageHandlers = require("./handlers/stock-images");

// All HTTP handlers merged into a single dispatch map
const handlers = {
  ...remoteHandlers,
  ...kitHandlers,
  ...componentHandlers,
  ...portalHandlers,
  ...pageHandlers,
  ...nodeHandlers,
  ...siteConfigHandlers,
  ...discoveryHandlers,
  ...seoHandlers,
  ...stockImageHandlers,
};

// Tools that are HTTP-only (no filesystem / TemplateBuilder needed)
const HTTP_TOOL_NAMES = new Set(Object.keys(handlers));

// Tools excluded from the agent endpoint (auth handled per-request)
const AGENT_EXCLUDED = new Set([
  "register",
  // Large payload tool (manual/debug only; not for public agent flows)
  "pull_site",
  // Block library admin tools
  "save_block",
  "update_block",
  "patch_block",
  "patch_block_bulk",
  "delete_block",
  // Template admin tools
  "save_template",
  "update_template",
  "delete_template",
  "publish_site_as_template",
]);
const AGENT_ALLOWED = new Set(
  [...HTTP_TOOL_NAMES].filter(name => !AGENT_EXCLUDED.has(name))
);

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

/**
 * Execute a tool only if it is exposed on the public agent endpoint.
 */
async function executeAgentTool(name, args) {
  if (!AGENT_ALLOWED.has(name)) {
    throw new Error(`Tool "${name}" is not available on this endpoint.`);
  }
  return executeTool(name, args);
}

module.exports = {
  // Branding (patch_site_node guardrails)
  isPlaceholderCompanyName,
  userExplicitlyRequestsBrandingChange,
  guardRootCompanyPropsPatch,

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
  executeAgentTool,
  handlers,

  // Constants
  HTTP_TOOL_NAMES,
  AGENT_EXCLUDED,
  AGENT_ALLOWED,
};
