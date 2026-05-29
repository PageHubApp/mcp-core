# Examples

Runnable scripts demonstrating `@pagehub/mcp-core`.

## Setup

From the package root:

```bash
npm install
# For example 03 only:
npm install ai @ai-sdk/anthropic
```

Get a free PageHub API key at [pagehub.dev](https://pagehub.dev).
For example 03 also get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com).

## 01 — List tools

No API key required. Dumps all 85 tool names grouped by verb.

```bash
node examples/01-list-tools.js
```

## 02 — Execute a tool

Calls `list_sites` against the live PageHub API.

```bash
PAGEHUB_API_KEY=ph_... node examples/02-execute-tool.js
```

Shows the **two core primitives**:

- `runWithContext(ctx, fn)` — seeds request context (AsyncLocalStorage)
- `executeTool(name, args)` — runs a tool; the handler reads `ctx.apiKey` automatically

## 03 — Claude Agent SDK loop

Full agent loop where Claude picks PageHub tools in response to a natural-language prompt.

```bash
PAGEHUB_API_KEY=ph_... ANTHROPIC_API_KEY=sk-ant-... \
  node examples/03-claude-agent.js "create a coffee shop landing page"
```

Pattern shown:

1. `getAgentTools()` returns 67 tool schemas in Claude API format (`input_schema` not `inputSchema`)
2. Wrap each schema in the AI SDK's `tool()` helper, pointing `execute` at `executeAgentTool`
3. Wrap the whole `generateText` call in `runWithContext` so every tool execution sees the auth context

Swap `anthropic()` for `openai()`, `google()`, or `gateway()` from the Vercel AI SDK — the tool surface is the same.

## How it fits together

```
User prompt
    │
    ▼
generateText({ tools, prompt })   ◄─── AI SDK
    │
    ▼  (model picks a tool)
tool.execute(args)
    │
    ▼
executeAgentTool(name, args)      ◄─── @pagehub/mcp-core
    │
    ▼  (reads apiKey from AsyncLocalStorage)
handler(args) → apiFetch(...)     ◄─── PageHub HTTP API
    │
    ▼
{ content: [{ type: "text", text: "..." }] }
```

The same handler runs whether called from:

- An MCP stdio server (Claude Desktop, Cursor)
- An in-app AI chat
- A standalone agent script like the one above
