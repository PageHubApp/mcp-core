# @pagehub/mcp-core

[![npm version](https://img.shields.io/npm/v/@pagehub/mcp-core.svg)](https://www.npmjs.com/package/@pagehub/mcp-core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js: 18+](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

The toolset that powers PageHub's AI integrations — 98 typed tools for building, editing, and publishing websites programmatically.

This is the shared core: tool schemas (MCP-compatible), HTTP handlers against the PageHub API, request context, and validation helpers. It's consumed by:

- [`@pagehub/mcp`](https://github.com/PageHubApp/mcp) — stdio MCP server (use with Claude Desktop, Cursor, etc.)
- PageHub's in-app AI agent (chat-driven editor)
- Your own [Claude Agent SDK](https://docs.claude.com/en/docs/claude-code/sdk) / OpenAI / Vercel AI scripts

## What's PageHub?

A visual + AI website builder. The MCP tools let an LLM create sites, edit their HTML + Liquid files, place blocks, set themes, manage pages, run accessibility/SEO audits, search stock media, and publish — all against [pagehub.dev](https://pagehub.dev) via authenticated HTTP.

## Install

```bash
npm install @pagehub/mcp-core
# or
pnpm add @pagehub/mcp-core
```

Node.js 18+.

## Quick start

```js
const { runWithContext, executeTool, getAllTools } = require("@pagehub/mcp-core");

// 1. Inspect available tools (MCP schema)
const tools = getAllTools(); // 98 tools

// 2. Run a tool inside a request context
const result = await runWithContext(
  {
    apiKey: process.env.PAGEHUB_API_KEY,
    apiBaseUrl: "https://pagehub.dev",
  },
  () => executeTool("list_sites", {})
);

console.log(result.content[0].text);
```

Get a free API key by signing up at [pagehub.dev](https://pagehub.dev) or calling the `register` tool with an email.

See [`examples/`](examples/) for runnable scripts (list tools, execute a tool, full Claude Agent SDK loop).

## Use with Claude Agent SDK

```js
const { generateText, tool } = require("ai");
const { gateway } = require("ai");
const { getAgentTools, runWithContext, executeAgentTool } = require("@pagehub/mcp-core");

const schemas = getAgentTools(); // 67 tools safe for public agents

const aiTools = Object.fromEntries(
  schemas.map(s => [
    s.name,
    tool({
      description: s.description,
      parameters: s.input_schema,
      execute: args => executeAgentTool(s.name, args),
    }),
  ])
);

await runWithContext({ apiKey: process.env.PAGEHUB_API_KEY }, () =>
  generateText({
    model: gateway("anthropic/claude-sonnet-4-6"),
    tools: aiTools,
    prompt: "Create a landing page for a coffee shop.",
  })
);
```

## Tool catalog

About 100 tools across 11 domains. The full schemas live in [`src/data/tools.json`](src/data/tools.json).

| Domain         | Examples                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| Sites          | `list_sites`, `create_site`, `select_site`, `publish_site`, `unpublish_site`  |
| Templates      | `list_templates`, `pull_template`, `save_template`, `update_template`         |
| Pages          | `list_pages`, `add_page`, `update_page`, `delete_page`                        |
| Files          | `list_site_files`, `read_site_file`, `edit_site_file`, `edit_site_files`      |
| Blocks         | `search_blocks`, `get_block`, `save_block`, `patch_block`, `apply_kit_block`  |
| Theme & Design | `set_theme`, `suggest_palettes`, `suggest_font_pairings`, `set_favicon`       |
| Stripe         | `stripe_connect`, `set_checkout`, `refresh_products`, `stripe_search_products` |
| Media          | `upload_image`, `find_image`, `find_video` (Pexels / Unsplash)                |
| SEO            | `audit_seo`, `audit_accessibility`                                            |
| Portal         | `set_portal`, `get_portal`, `remove_portal`                                   |
| Site Config    | `set_integrations`, `set_redirects`                                           |

## Public API

```js
const {
  // Tool execution
  runWithContext, // (ctx, fn) — seed request context (AsyncLocalStorage)
  getContext, // () — read current context
  executeTool, // (name, args) — execute any HTTP tool
  executeAgentTool, // (name, args) — execute only agent-allowed tools
  handlers, // raw handler map

  // Schemas
  getAllTools, // every tool, MCP format ({inputSchema})
  getAgentTools, // the public-agent-safe tools, Claude API format ({input_schema})

  // Sets
  HTTP_TOOL_NAMES,
  AGENT_ALLOWED,
  AGENT_EXCLUDED,

  // Helpers
  apiFetch,
  parseMaybeJson,
} = require("@pagehub/mcp-core");
```

## Subpath imports

For handler delegation patterns (e.g. wrapping individual tools), import handlers directly:

```js
const site = require("@pagehub/mcp-core/handlers/site-config"); // { set_integrations, set_favicon, set_redirects }
const seo = require("@pagehub/mcp-core/handlers/seo"); // { audit_seo, audit_accessibility }
const ai = require("@pagehub/mcp-core/ai-models"); // ESM — AI model defaults
```

Available subpaths: `handlers/{discovery,portal,remote,remote-collections,seo,site-config,stock-images,stock-videos}`, `ai-models`. Internals (`core/`, `helpers/`, `utils/`, `validation/`, `data/`, `lib/`) are not part of the public API.

## Source layout

```
src/
├── index.js              ← public entry
├── ai-models.mjs         ← ESM: AI model defaults
├── core/                 ← context, api-fetch, direct upload
├── handlers/             ← HTTP tool implementations (one file per domain)
│   └── seo/              ← SEO + a11y audit (server-rendered draft page)
├── helpers/              ← shared handler utilities (target, file edits, library, publish state)
├── validation/           ← button, branding validators
├── utils/                ← pure utilities (color)
├── data/                 ← static data: tools.json, instructions, style reference, vibes, categories
└── lib/                  ← theme-fonts
```

See [`src/README.md`](src/README.md) for a per-folder breakdown.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the handler contract, context system, and how to add a new tool.

## License

[MIT](LICENSE)
