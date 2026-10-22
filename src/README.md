# mcp-core source layout

Map of every folder under `src/`. Use this to decide where new code belongs.

## handlers/

Public tool implementations. Each file groups tools by domain — `html-pages`
(pages), `remote-files` (the file tools), `library-format` (blocks and
components), `portal`, `seo`, `site-config`, `html-settings` (theme,
integrations, favicon), `stock-images`, `stock-videos`, `icons`, plus the
`remote-*` family (`remote-sites`, `remote-templates`, `remote-theme`,
`remote-stripe`, `remote-collections`, `remote-emails`, …) for HTTP-backed
operations. `remote.js` re-exports the `remote-*` files. Every handler is
`async (args) => ToolResult`.

## helpers/

Cross-handler shared logic — argument parsing (`args.js`), target resolution
(`target.js`), exact-text file edits (`file-edits.js`), the block and
component library (`html-library.js`), the publish-state trailer
(`publish-state.js`), the AI write guard. Add here when two or more handler
files need the same code.

## core/

Per-request plumbing that has no business logic: `context.js`
(`runWithContext`, `getContext`), `api-fetch.js` (authed HTTP) and
`direct-upload.js` (signed direct uploads).

## validation/

Pure validators with no I/O: the branding guard and the button class system
(`button-system.js`). Add here for new lint-style rules.

## data/

Static catalogs loaded at boot — `tools.json` (the master tool schema list, with
`$VIBES` / `$CATEGORIES` sentinels resolved in `index.js`), `instructions.js`
(the server instructions), `style-reference.js` (`get_style_reference`),
`vibes.js`, `categories.js`.

## utils/

Pure transforms with no dependencies on context, network, or other internal
modules — `color-utils.js`. Anything reusable across handlers AND helpers
belongs here.

## lib/

`theme-fonts.js`: Google Fonts URL helpers shared with the app's importers.
