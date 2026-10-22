/**
 * @file Public entry for `@pagehub/mcp-core`. Exports the tool dispatch surface,
 * per-request context helpers, and a curated set of shared helpers consumed by
 * the HTTP server and in-app agent.
 *
 * @typedef {object} ToolResult
 * Standard shape returned by every tool handler. `content` is the MCP-spec
 * payload (a list of text blocks); the optional fields are PageHub extensions
 * used by the in-app agent to forward streaming UI state.
 * @property {Array<{ type: 'text', text: string }>} content - Human/agent-readable result blocks.
 * @property {boolean} [isError] - True when the handler short-circuited with a recoverable error.
 *
 * @typedef {object} McpContext
 * Per-request context seeded by {@link runWithContext}. See `core/context.js`
 * for the live shape; the most commonly read fields are listed here.
 * @property {string} apiKey - PageHub API key used by `apiFetch`.
 * @property {string} apiBaseUrl - Normalized base URL for HTTP-backed handlers.
 * @property {{ id: string }} [activeSite] - Site selected for this request.
 * @property {boolean} [stageFileEdits] - HTML-first review mode: file reads/writes use the staged AI draft (`X-PageHub-Stage`).
 */

const rawTools = require("./data/tools.json");
const { VIBE_CODENAMES } = require("./data/vibes");
const { SERVER_INSTRUCTIONS } = require("./data/instructions");
const { CATEGORIES } = require("./data/categories");

// Resolve schema sentinels (`"$VIBES"`, `"$CATEGORIES"`) wherever they appear in
// `enum` fields with the live arrays. Keeps tools.json human-readable while
// making each list authoritative in one place. Safe — no existing value in
// tools.json starts with "$".
function resolveSentinels(node) {
  if (node === "$VIBES") return [...VIBE_CODENAMES];
  if (node === "$CATEGORIES") return [...CATEGORIES];
  if (Array.isArray(node)) return node.map(resolveSentinels);
  if (node && typeof node === "object") {
    const out = {};
    for (const k of Object.keys(node)) out[k] = resolveSentinels(node[k]);
    return out;
  }
  return node;
}
const tools = resolveSentinels(rawTools);
const TOOLS_BY_NAME = new Map(tools.map(t => [t.name, t]));
const { assertAiWriteAllowed } = require("./helpers/aiWriteGuard");
const { isPlaceholderCompanyName, userExplicitlyRequestsBrandingChange } = require("./validation/branding-guard");
const { runWithContext, getContext } = require("./core/context");
const { apiFetch, normalizeBaseUrl } = require("./core/api-fetch");
const { uploadBytesToSite } = require("./core/direct-upload");
const { formatUploadResult } = require("./helpers/upload-format");
const { formatImportStatus, presignImport, startImport } = require("./handlers/remote-import");
const { parseMaybeJson } = require("./helpers/args");
const { runToolWithPublishTrailer } = require("./helpers/publish-state");
const { getActiveTarget, getActiveSiteId, getEditorUrl } = require("./helpers/target");
const remoteHandlers = require("./handlers/remote");
const htmlPageHandlers = require("./handlers/html-pages");
const portalHandlers = require("./handlers/portal");
const siteConfigHandlers = require("./handlers/site-config");
const discoveryHandlers = require("./handlers/discovery");
const seoHandlers = require("./handlers/seo");
const stockImageHandlers = require("./handlers/stock-images");
const stockVideoHandlers = require("./handlers/stock-videos");
const iconHandlers = require("./handlers/icons");
const collectionsHandlers = require("./handlers/remote-collections");
const fileHandlers = require("./handlers/remote-files");
const libraryFormatHandlers = require("./handlers/library-format");

// All HTTP handlers merged into a single dispatch map
const handlers = {
  ...remoteHandlers,
  ...htmlPageHandlers,
  ...portalHandlers,
  ...siteConfigHandlers,
  ...discoveryHandlers,
  ...seoHandlers,
  ...stockImageHandlers,
  ...stockVideoHandlers,
  ...iconHandlers,
  ...collectionsHandlers,
  ...fileHandlers,
  ...libraryFormatHandlers,
};

// Tools that are HTTP-only (no filesystem / TemplateBuilder needed)
const HTTP_TOOL_NAMES = new Set(Object.keys(handlers));

// Tools excluded from the agent endpoint (auth handled per-request)
const AGENT_EXCLUDED = new Set([
  // Block library admin tools
  "save_block",
  "update_block",
  "patch_block",
  "delete_block",
  // Template admin tools
  "save_template",
  "update_template",
  "delete_template",
  "publish_site_as_template",
]);
const AGENT_ALLOWED = new Set([...HTTP_TOOL_NAMES].filter(name => !AGENT_EXCLUDED.has(name)));

/**
 * Get tool schemas for the public agent endpoint.
 * Filters to HTTP-only tools and excludes auth/admin tools (see `AGENT_EXCLUDED`).
 * Output uses Claude API shape (`input_schema`), NOT the MCP shape (`inputSchema`).
 * `title` and `annotations` are MCP-only metadata (the MCP route passes them to
 * clients); callers building Claude API tool definitions must not forward them.
 *
 * @returns {Array<{ name: string, title?: string, description: string, annotations?: object, input_schema: object }>}
 */
function getAgentTools() {
  return tools
    .filter(t => HTTP_TOOL_NAMES.has(t.name) && !AGENT_EXCLUDED.has(t.name))
    .map(t => ({
      name: t.name,
      title: t.annotations?.title,
      description: t.description,
      annotations: t.annotations,
      input_schema: withoutLocalOnlyProps(t.inputSchema),
    }));
}

// Params that read the caller's own disk. Only the stdio server (which lists
// tools through `getAllTools`) can honour them; every agent-endpoint handler
// rejects them, so they are not advertised there.
const LOCAL_ONLY_PROPS = ["filePath"];

function withoutLocalOnlyProps(schema) {
  const props = schema?.properties;
  if (!props || !LOCAL_ONLY_PROPS.some(k => k in props)) return schema;
  const properties = { ...props };
  for (const k of LOCAL_ONLY_PROPS) delete properties[k];
  const next = { ...schema, properties };
  if (Array.isArray(schema.required)) {
    next.required = schema.required.filter(k => !LOCAL_ONLY_PROPS.includes(k));
  }
  return next;
}

/**
 * Get all tool schemas in MCP format (`inputSchema`).
 * Includes both HTTP and admin tools — use {@link getAgentTools} for the
 * filtered public surface.
 *
 * @returns {Array<{ name: string, description: string, inputSchema: object }>}
 */
function getAllTools() {
  return tools;
}

/**
 * Execute a tool by name within the current request context. Must be called
 * inside a {@link runWithContext} scope so handlers can read auth + active
 * site from AsyncLocalStorage.
 *
 * @param {string} name - Registered tool name (must match a key in `handlers`).
 * @param {object} args - Tool arguments matching the schema in `tools.json`.
 * @returns {Promise<ToolResult>} Standard handler result.
 * @throws {Error} If `name` is not a registered handler.
 */
async function executeTool(name, args) {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  const ctx = getContext();
  assertAiWriteAllowed(name, args, ctx, TOOLS_BY_NAME.get(name));
  return runToolWithPublishTrailer(handler, args, ctx);
}

/**
 * Execute a tool only if it is exposed on the public agent endpoint.
 * Same contract as {@link executeTool} but rejects admin / restricted tools.
 *
 * @param {string} name - Registered tool name.
 * @param {object} args - Tool arguments.
 * @returns {Promise<ToolResult>} Standard handler result.
 * @throws {Error} If the tool is not in `AGENT_ALLOWED`.
 */
async function executeAgentTool(name, args) {
  if (!AGENT_ALLOWED.has(name)) {
    throw new Error(`Tool "${name}" is not available on this endpoint.`);
  }
  return executeTool(name, args);
}

module.exports = {
  isPlaceholderCompanyName,
  userExplicitlyRequestsBrandingChange,

  // Core
  runWithContext,
  getContext,
  apiFetch,
  normalizeBaseUrl,
  uploadBytesToSite,
  formatUploadResult,
  formatImportStatus,
  presignImport,
  startImport,

  // Helpers
  parseMaybeJson,
  runToolWithPublishTrailer,
  getActiveTarget,
  getActiveSiteId,
  getEditorUrl,

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
  VIBE_CODENAMES,
  CATEGORIES,
  SERVER_INSTRUCTIONS,
};
