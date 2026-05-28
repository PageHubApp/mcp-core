# Contributing to `@pagehub/mcp-core`

Read this before adding a tool, helper, or validator. The package is the
shared dispatch surface for the PageHub HTTP MCP server and the in-app
agent — small contract violations break both.

## Handler contract

Every handler is:

```js
async (args) => ToolResult
```

where `ToolResult` is:

```ts
{
  content: Array<{ type: "text"; text: string }>;
  // Optional PageHub extensions:
  isError?: boolean;          // recoverable failure (still returns 200)
  changedNodes?: string[];    // node IDs the handler mutated (editor highlight)
  pendingContent?: object;    // in-flight flat node map / theme state for draft mode
}
```

Handlers must never throw for user errors — return `{ content, isError: true }`
instead. Throw only for programmer errors (missing context, unknown tool).

## Context system

Every handler runs inside an `AsyncLocalStorage` scope seeded by:

```js
const { runWithContext, getContext } = require("@pagehub/mcp-core");

await runWithContext({ apiKey, apiBaseUrl, activeSite, ... }, () =>
  executeTool("apply_kit_block", { ... })
);
```

Read the active context inside handlers via `getContext()`. Common fields
(see `src/core/context.js` for the live shape):

| Field              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `apiKey`           | Bearer token used by `apiFetch`                      |
| `apiBaseUrl`       | Normalized base URL for HTTP-backed handlers         |
| `activeSite`       | `{ id }` of the site selected for this request       |
| `activeTemplate`   | `{ slug }` of the template selected for this request |
| `activePageNodeId` | Active page node (in-app agent only)                 |
| `draftMode`        | Accumulate mutations in `_pendingFlatMap` (no save)  |
| `fillMode`         | Route through fill-mode patch merge                  |

## Draft mode pattern

Handlers that mutate flat node maps should go through:

```js
const { withTargetSaveOrDraft } = require("../helpers/load-mutate-save");

return withTargetSaveOrDraft(args, async (flat) => {
  // mutate `flat` in place
}, (flat) => ({ content: [{ type: "text", text: "ok" }] }));
```

This handles draft vs persisted writes, fetches the target, and centralises
error reporting. Skip the helper **only** when you have early-return guards
or `fillMode` branches that don't fit — see `set_theme` and `move_node` for
the exception shape.

## Mutating tools that touch ROOT

Wrap the body in `withPendingMapLock` so parallel tool calls from one
assistant turn don't race on `ctx._pendingFlatMap`:

```js
const { withPendingMapLock } = require("../core/context");

return withPendingMapLock(() => bodyFn());
```

Existing examples: `apply_kit_block` in `handlers/kit.js`, `set_theme` in
`handlers/remote-theme.js`. Skipping this on a ROOT-touching handler causes
silent data loss (see the comment in `core/context.js`).

## Adding a new tool

1. **Schema** — add the tool definition to `src/data/tools.json`. Use
   `$VIBES` / `$CATEGORIES` sentinels in `enum` fields where applicable.
2. **Handler** — add the handler function to a `src/handlers/*.js` file
   (or create a new domain file). Export it from `module.exports`.
3. **Dispatch** — if you created a new handler file, require it at the top
   of `src/index.js` and spread it into the `handlers` map.
4. **Agent policy** — decide if the tool should be reachable from the
   public agent endpoint. Admin / destructive tools go in `AGENT_EXCLUDED`
   in `src/index.js`. Everything else is automatically allowed.

## Where utility code goes

| Code kind                                  | Location          |
| ------------------------------------------ | ----------------- |
| Pure transforms (no I/O, no context)       | `src/utils/`      |
| Cross-handler shared logic                 | `src/helpers/`    |
| Validation rules (a11y, branding, buttons) | `src/validation/` |
| Per-request plumbing (auth, context, HTTP) | `src/core/`       |
| Encoding / compression                     | `src/codec/`      |
| Static catalogs                            | `src/data/`       |

If you're tempted to import from a sibling `handlers/*.js` file, the code
probably belongs in `helpers/` or `utils/` instead.

## Public API surface (semver)

The following are part of the public surface — changing them is a **major**
version bump:

- The `module.exports` shape of `src/index.js`.
- The `module.exports` shape of any `src/handlers/*.js` file.
- The argument schema of any tool in `src/data/tools.json`.
- The shape of `ToolResult`.

Internal moves (splitting a handler into a `handlers/kit/` sub-folder,
adding a new helper, renaming an unexported function) are free.

## Tests

Run the smoke test before opening a PR:

```bash
node -e "
const c = require('./src/index.js');
const t = c.getAllTools().length;
console.log('tools:', t);
"
```

The tool count is asserted in CI — adding or removing a tool means
updating the assertion in the same PR.
