# @pagehub/mcp-core

Shared tool schemas and HTTP handlers for [PageHub](https://pagehub.dev) MCP and AI agent integrations.

This package provides the core building blocks — tool definitions, API client, request context, and HTTP-based handlers — used by the PageHub MCP server and AI agent endpoint.

## Installation

```bash
npm install @pagehub/mcp-core
```

Requires Node.js 18+.

## Quick Start

```js
const { runWithContext, executeTool, getAllTools } = require("@pagehub/mcp-core");

// Get all tool schemas (MCP format)
const tools = getAllTools();

// Execute a tool within an authenticated context
const result = await runWithContext(
  {
    apiKey: process.env.PAGEHUB_API_KEY,
    apiBaseUrl: "https://pagehub.dev",
  },
  () => executeTool("list_sites", {})
);

console.log(result.content[0].text);
```

## API Key

Get a free API key by calling the `register` tool with your email, or sign up at [pagehub.dev](https://pagehub.dev). Set it as the `PAGEHUB_API_KEY` environment variable or pass it via `runWithContext`.

## Exports

### Core

| Export                    | Description                                                              |
| ------------------------- | ------------------------------------------------------------------------ |
| `runWithContext(ctx, fn)` | Run a function with per-request context (apiKey, apiBaseUrl, activeSite) |
| `getContext()`            | Get the current request context                                          |
| `apiFetch(path, opts)`    | Authenticated fetch against the PageHub API                              |
| `normalizeBaseUrl(url)`   | Strip trailing slashes from URLs                                         |

### Tools

| Export                    | Description                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `getAllTools()`           | All 49 tool schemas (MCP format with `inputSchema`)                                           |
| `getAgentTools()`         | HTTP-only tool schemas (Claude API format with `input_schema`), excludes auth-sensitive tools |
| `executeTool(name, args)` | Execute an HTTP-based tool by name within the current context                                 |
| `executeAgentTool(name, args)` | Execute only tools exposed on the public agent endpoint                                |
| `handlers`                | Raw handler function map                                                                      |

### Helpers

| Export                                       | Description                                              |
| -------------------------------------------- | -------------------------------------------------------- |
| `parseMaybeJson(v)`                          | Safely parse a JSON string, return as-is on failure      |
| `applyNodePatches(flatMap, nodeId, patches)` | Shallow-merge patch objects into a CraftJS flat node map |
| `normalizeNodePatchArgs(raw)`                | Parse and normalize raw patch arguments                  |

### Constants

| Export            | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `HTTP_TOOL_NAMES` | Set of tool names with HTTP handlers in this package |
| `AGENT_EXCLUDED`  | Set of tool names excluded from the agent endpoint   |
| `AGENT_ALLOWED`   | Set of tool names allowed on the public agent endpoint |

## HTTP Handlers (24 tools)

These handlers make API calls to PageHub and are included in this package:

**Sites** — `list_templates`, `pull_template`, `list_sites`, `select_site`, `pull_site`, `save_site`, `delete_site`, `add_nodes`, `suggest_palettes`, `upload_image`, `patch_site_node`, `patch_site_bulk`

**Nodes** — `delete_node`, `insert_node`, `move_node`, `list_site_nodes`, `search_site_nodes`

**Pages** — `list_pages`, `add_page`, `update_page`, `delete_page`

**Blocks** — `search_blocks`, `get_block`, `list_block_nodes`, `patch_block`, `patch_block_bulk`, `save_block`, `update_block`, `delete_block`

**Portal** — `set_portal`, `get_portal`, `remove_portal`

## Full Tool Schema (49 tools)

The `tools.json` file contains schemas for all 49 PageHub tools. The remaining 25 tools (template building, theming, blocks, AI generation, audits) require filesystem access to the TemplateBuilder and are implemented in the full [`@pagehub/mcp`](https://github.com/nicholasgcoles/pagehub.dev/tree/main/packages/mcp) server package.

## Architecture

```
@pagehub/mcp-core          @pagehub/mcp (full server)
├── tools.json (all 49)     ├── imports mcp-core
├── context.js              ├── local handlers (25 tools)
├── api-fetch.js            │   ├── sections, themes
├── helpers.js              │   ├── nav, footer
└── handlers/               │   ├── AI generation
    ├── remote.js           │   └── audits, patterns
    ├── nodes.js            └── MCP stdio transport
    ├── components.js
    ├── pages.js
    └── portal.js
```

## License

[MIT](LICENSE)
