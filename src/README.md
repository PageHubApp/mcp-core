# mcp-core source layout

Map of every folder under `src/`. Use this to decide where new code belongs.

## handlers/

Public tool implementations. Each file groups tools by domain — `kit`,
`components`, `nodes`, `pages`, `portal`, `seo`, `site-config`,
`stock-images`, `stock-videos`, `icons`, `section-tree`, plus the
`remote-*` family (`remote-sites`, `remote-templates`, `remote-theme`,
`remote-nodes`, `remote-stripe`, `remote-collections`) for HTTP-backed
operations. The barrel files (`kit.js`, `components.js`,
`remote-nodes.js`, `seo.js`, `remote.js`) re-export from their split
sub-folders. Every handler is `async (args) => ToolResult`.

## helpers/

Cross-handler shared logic — argument parsing (`args.js`), node patch
application (`node-patch.js`), target resolution and save-or-draft
plumbing (`target.js`, `load-mutate-save.js`), fill-mode helpers
(`fill-mode.js`, `fill-patch-merge.js`), image extraction, modifier
shaping, and the `patch/` sub-folder for low-level patch utilities.
Add here when two or more handler files need the same code.

## core/

Per-request plumbing that has no business logic: `context.js`
(`runWithContext`, `getContext`, `withPendingMapLock`), `api-fetch.js`
(authed HTTP), `active-page.js` (resolving the active page node), and
`component-registry.js` (in-memory component schema cache).

## codec/

Encoding utilities — LZ-string compression (`lz.js`) and the structure
ingestion pipeline (`structure-ingest.js`) used by site / template
import paths.

## validation/

Pure validators with no I/O. Node shape checks (`node-validation.js`),
accessibility audits (`a11y-check.js`), the branding guard that
protects ROOT company props (`branding-guard.js`), and the button
class system (`button-system.js`). Add here for new lint-style rules.

## data/

Static catalogs loaded at boot — `tools.json` (the master tool schema
list, with `$VIBES` / `$CATEGORIES` sentinels resolved in `index.js`),
`vibes.js`, `categories.js`, `root-design-intent.js`.

## utils/

Pure transforms with no dependencies on context, network, or other
internal modules — `node-utils.js`, `color-utils.js`,
`levenshtein.js`. Anything reusable across handlers AND helpers belongs
here.

## lib/

Third-party-ish code originally imported from elsewhere in the
monorepo — `theme-fonts.js`. Keep this folder for code we vendored
rather than authored from scratch.
