/**
 * Content served by the `get_style_reference` tool.
 *
 * `STYLE_REFERENCE` is the core styling reference returned with no `topic`.
 * `STYLE_TOPICS` holds on-demand guides (design bar, accessibility, domains,
 * per-tool usage). The server instructions and tool descriptions stay short and
 * point here, so this text is only paid for when an agent asks for it.
 */

const STYLE_REFERENCE = `# PageHub Style Reference

## Palette CSS Variables (set via set_theme palette array)

| Variable | Slot | Typical Use |
|----------|------|-------------|
| var(--primary) | 0 | Main brand color (buttons, links, hero backgrounds) |
| var(--primary-content) | 1 | Text on primary backgrounds |
| var(--secondary) | 2 | Supporting color (cards, badges, secondary buttons) |
| var(--secondary-content) | 3 | Text on secondary backgrounds |
| var(--accent) | 4 | CTA/highlight color (call-to-action buttons, emphasis) |
| var(--accent-content) | 5 | Text on accent backgrounds |
| var(--neutral) | 6 | Muted color (borders, disabled, subtle backgrounds) |
| var(--neutral-content) | 7 | Text on neutral backgrounds |
| var(--base-100) | 8 | Page/site background |
| var(--base-content) | 9 | Default body text |
| var(--base-200) | 10 | Alternate section backgrounds, cards, dividers |
| var(--base-300) | 11 | Deeper alternates, heavy borders |

## Style Guide CSS Variables (set via set_theme styleGuide)

| Variable | Key | Default |
|----------|-----|---------|
| --radius-box | radiusBox | 0.5rem |
| --radius-field | radiusField | 0.25rem |
| --radius-selector | radiusSelector | 0.5rem |
| --size-field | sizeField | 0.25rem |
| --size-selector | sizeSelector | 0.25rem |
| --depth | depth | 1 |
| --noise | noise | 0 |
| --button-padding-x / -y | buttonPadding | 1.5rem 0.75rem |
| --container-padding / -x / -y | containerPadding | 2rem 2rem |
| --content-width | contentWidth | 80rem |
| --shadow-style | shadowStyle | 0 1px 3px rgba(0,0,0,0.1) |
| --heading-font-family | headingFontFamily | (from Google Fonts) |
| --body-font-family | bodyFontFamily | (from Google Fonts) |

## Using Variables in className

ALWAYS use CSS variables via Tailwind token syntax in className — never hardcode hex or named colors:

  "bg-primary text-primary-content border-base-200 rounded-box gap-container max-w-page"

Exception: bg-transparent, bg-white/10 (opacity modifiers) are OK.

## Responsive Pattern (Mobile-First className)

All styling in a single props.className string:
- Unprefixed = base/mobile styles
- md: prefix = desktop (768px+)
- lg: prefix = large screens (1024px+)

Example: "flex flex-col gap-space-sm py-space-lg px-container-x bg-base-100 text-base-content md:flex-row"

Spatial tokens (fluid clamp, NO md:py-* or md:gap-* needed):
  --space-xs (micro), --space-sm (element), --space-md (content), --space-lg (section), --space-xl (hero)

## Common className Utilities

Layout: flex, flex-col, flex-row, grid, grid-cols-*, gap-space-*, items-*, justify-*,
  w-full, w-1/2, max-w-page, h-[400px], min-h-screen,
  py-space-*, px-container-x, mx-auto, relative, absolute, z-*, overflow-hidden

Surface: bg-primary, text-base-content, border, border-base-200,
  rounded-box, shadow-sm, shadow-md

Typography: text-4xl, font-bold, leading-relaxed, tracking-widest, uppercase

## Background Image Overlays

Use the \`backgroundOverlay\` prop on Container to layer gradients over background images:
- Presets: "dark-left", "dark-right", "dark-bottom", "dark-top", "dark", "light"
- Custom: { direction: "to right", from: { color: "#000", opacity: 85 }, to: { color: "#000", opacity: 20 } }
- Do NOT use root.style for overlays — use this prop.

## Form Styling

FormElement inputs must be explicitly styled — they don't inherit card backgrounds:
- Input bg must differ from parent card bg (e.g. \`bg-base-300\` input inside \`bg-base-200\` card)
- Use styleGuide tokens: inputBorderColor, inputBgColor, inputTextColor, inputPlaceholderColor, inputFocusRingColor
- Submit button: use canonical CTA classes (\`btn btn-primary cta-responsive rounded-box px-space-md py-space-xs min-h-12 font-semibold\`)

## Template Variables

| Variable | Example |
|----------|---------|
| {{company.name}} | Acme Inc. |
| {{company.tagline}} | The ultimate solution |
| {{company.type}} | technology |
| {{company.location}} | Los Angeles, CA |
| {{company.address}} | 123 Main St, Suite 100 |
| {{company.phone}} | (555) 123-4567 |
| {{company.email}} | contact@acme.com |
| {{company.website}} | https://www.acme.com |
| {{year}} | (current year, dynamic) |

## Component Modifiers (Composable CSS Presets)

Modifiers are reusable class compositions toggled on components. PREFER modifiers over raw classes when the pattern exists or is likely reused. One-offs are fine as raw classes.

**Storage: ROOT.props.modifiers** (not ROOT.props.theme.modifiers).

### Composite Modifiers (multi-class presets — use instead of writing classes out)

| Component | Name | Expands To |
|-----------|------|------------|
| Container | section-wrapper | bg-base-100 text-base-content flex flex-col items-center w-full py-space-lg px-container-x |
| Container | section-wrapper-dark | bg-base-content text-base-100 flex flex-col items-center w-full py-space-lg px-container-x |
| Container | card-surface | card bg-base-200 text-base-content rounded-box flex flex-col w-full overflow-hidden |
| Container | icon-row | flex flex-row gap-space-xs items-center w-full |
| Container | content-col | flex flex-col gap-space-md w-full max-w-page mx-auto |
| Container | hero-content-centered | hero-content flex flex-col items-center gap-space-md text-center max-w-page mx-auto |
| Text | body-text | text-neutral-content text-sm leading-relaxed |
| Text | section-heading | font-bold leading-tight text-base-content text-3xl md:text-4xl font-heading |
| Text | eyebrow | text-primary font-bold tracking-widest text-xs uppercase |
| Text | subhead | text-neutral-content text-lg leading-relaxed max-w-2xl |
| Button | cta-responsive | btn btn-primary rounded-box px-space-md py-space-xs min-h-12 font-semibold w-full md:w-auto |
| Button | cta-outline-responsive | btn btn-outline rounded-box px-space-md py-space-xs min-h-12 font-semibold border-base-content/30 text-base-content w-full md:w-auto |

### Single-Class Modifiers (stackable with composites)

| Component | Available Modifiers |
|-----------|-------------------|
| Button | btn-primary, btn-secondary, btn-accent, btn-neutral, btn-outline, btn-ghost, btn-soft, btn-dash, btn-link, btn-xs..xl, btn-wide, btn-block, btn-circle, btn-square |
| Container | card, card-body, hero, hero-content, p-space-xs..xl, bg-base-100..200, bg-primary..accent, w-full, w-1/2, mx-auto, overflow-hidden |
| Text | text-xs..5xl, font-light..extrabold, text-left/center/right, uppercase, italic, font-heading, font-body |
| Image | rounded-box, rounded-full, rounded-none, object-cover, object-contain, aspect-square, aspect-video |

To apply composite: classNamePatch with expanded classes + propsPatch { root: { activeModifiers: ["section-wrapper"] } }
To apply single: classNamePatch "btn-outline btn-lg" + propsPatch { root: { activeModifiers: ["btn-outline", "btn-lg"] } }
Composites + singles stack: section-wrapper + bg-primary override surface color.

## Key Rules

1. Page containers (type: "page") must NOT have gap, py, px, p, my, mx — spacing goes on sections.
2. ROOT node must NOT have gap or spacing.
3. Text "text" values: NO block tags. Only inline: <strong>, <em>, <br/>, <span>, <a>, <ul>/<li>.
4. Always match text color to background: bg-primary → text-primary-content; bg-base-100 → text-base-content.
5. **Palette (outline CTAs):** On minimal monochrome themes, Primary and Base Content must differ in lightness — not both the same near-black OKLCH. DaisyUI 5 btn-outline uses --btn-color for label/border; if primary ≈ base-content, canonical outline + text-base-content can collapse to illegible dark-on-dark. Fix palette (and styleGuide linkColor/inputTextColor if Base Content changes).
6. Use descriptive node IDs: "sec_hero", "hero_title", etc.
7. **All styling uses props.className** — a single Tailwind class string. Mobile-first: unprefixed utilities apply at all widths; **md:** = 768px+; **lg:** = 1024px+. Example: "flex flex-col gap-4 py-8 md:flex-row md:gap-8 bg-primary text-primary-content". Use **classNamePatch** in patch tools to merge classes via twMerge. Use **propsPatch** only for non-class props (text, src, href, style, animation).
8. **Content colors:** your "* Content" palette entries ship only when they clear WCAG AA (4.5:1) on their surface; otherwise the renderer swaps in a derived color. set_theme warns when that will happen.

## Interactive State (quizzes, checklists, scores, tabs, toggles)

No custom JS. Everything is a shared key/value store driven by props:

| Piece | Prop | Notes |
|---|---|---|
| Write state on click | \`action: [{ type: "set-state", key, value }]\` (Button, Container, Text) | Also \`toggle-state\`, \`clear-state\`, \`increment-state\`, \`decrement-state\`. |
| Write on page load | same action + \`trigger: "load"\` | Seeds defaults / example answers. Fires once on mount, never on click. |
| Derive a value | Container \`computedStateBindings: [{ key, from: [keys], compute }]\` | compute \`type\`: \`count\` (\`value?\` = only count keys equal to it), \`all-truthy\`, \`first-truthy\`, \`join\` (\`separator\`). |
| Show a value | Text \`{{state.<key>}}\` (wrap: \`<span data-variable="state.<key>" class="variable-node">{{state.<key>}}</span>\`) | Also Button text / attrs. |
| Style by state | \`stateModifiers: [{ conditions, modifiers: [names] }]\` | Modifier names must exist in ROOT.props.modifiers[Component] (\`{ name, classes }\`) — use \`!\`-prefixed classes so they beat base classes. |
| Show/hide by state | \`conditionGroups\` with \`{ type: "state", key, operator, value }\` | operators: equals, not-equals, contains, not-contains, exists, not-exists. Or use stateModifiers to add \`!hidden\` / \`!flex\` when you need a guaranteed initial state. |

| Form sending / thank-you | Container \`visibilityStateKey: "form:<formNodeId>:fields" \\| ":loading" \\| ":loaded"\` | The Form writes these on submit (fields → hidden, loading → shown, then loaded → shown). **Required:** MCP-built forms have no confirmation otherwise. |

Conditions shape: \`[{ logic: "all" | "any", conditions: [...] }]\`.

**Recipe — form confirmation (every Form you build):**
1. Wrap every FormElement + the submit Button in one Container child of the Form: \`visibilityStateKey: "form:<formNodeId>:fields"\`.
2. Add a sibling Container \`visibilityStateKey: "form:<formNodeId>:loading"\`, \`attrs: { role: "status", "aria-live": "polite" }\`, className starting \`hidden\`, holding "Sending...".
3. Add a sibling Container \`visibilityStateKey: "form:<formNodeId>:loaded"\`, same attrs, className starting \`hidden\`, holding the thank-you copy (and any next-step links).
The Form's own \`loading\` / \`success\` / \`view\` props only feed slots the editor creates — they do nothing on a form you built with add_nodes.

**Recipe — scored checklist (e.g. "5 / 9"):**
1. Each Yes/No Button: \`action: [{ type: "set-state", key: "quiz:q1", value: "Y" }]\` / \`"N"\`, plus \`stateModifiers\` equals Y → an "active" modifier.
2. The card Container: \`computedStateBindings: [{ key: "quiz:score", from: ["quiz:q1", …], compute: { type: "count", value: "Y" } }]\`, and optional \`trigger: "load"\` set-state actions for example answers.
3. Score Text: \`{{state.quiz:score}}\`. Progress bar fill: one stateModifier per score value mapping to a width modifier (\`!w-[55.56%]\`).
4. Verdict blocks: stateModifiers on \`quiz:score\` with \`logic: "any"\` over the score values in each tier.

**Verify it:** state-driven UI only shows in a real browser — call \`screenshot_site\` with a \`selector\` after building, and again after changing values.
`;

const TECHNIQUE_TRANSFER_RULES = `
## Design Technique Transfer (when building from a reference)

- Extract TECHNIQUES, not descriptions. "It has a hero" is useless. "Full-bleed bg image with linear-gradient overlay, text bottom-left, pill CTA with arrow icon" is a technique.
- Micro-design elements to extract and transfer:
  - Eyebrow badges: pill shape, colored dot prefix, background fill, border-radius, padding
  - Button shapes: pill vs rectangle, icon placement, fill vs outline, hover effects
  - Dividers: vertical between stats, accent underlines, specific border widths/opacity
  - Stat numbers: oversized number + smaller suffix, font contrast, colored vs neutral
  - Section labels: badge vs plain text, dot prefix, background pill
- Typography tricks to transfer:
  - Fading text: last line of paragraph in muted color (use separate Text node with muted color, or partial span styling)
  - Size contrast: massive stat numbers vs tiny labels, large serif heading vs small sans body
  - Weight play: thin body (font-light) vs heavy headings (font-bold/font-extrabold)
- Layout structures copy 1:1 (these are patterns, not identity):
  - Nav: logo position, separator, link arrangement, right-side CTA
  - Hero: overlay type, gradient direction, text placement, CTA arrangement
  - Form cards: shadow, header, subtitle, response-time note, input styling
  - Split sections: column ratio, vertical alignment, content arrangement
- Visual depth techniques:
  - Background images with gradient overlays — prefer **backgroundOverlay** on Container with **background.image**; avoid root.style in block/kit JSON.
  - Section background rhythm — alternate white/tinted/white/dark, never 4+ same bg
  - Background overlays: use "backgroundOverlay" prop. Presets: "dark-left", "dark-right", "dark-bottom", "dark-top", "dark", "light". Custom: { direction: "to right", from: { color: "#000", opacity: 85 }, to: { color: "#000", opacity: 20 } }
  - For ad-hoc editor sites only (not library blocks): root.style may be used for backdrop-filter, rgba fills, etc. — never for image overlays (use backgroundOverlay).
- Before building each section: check "which extracted techniques am I applying here?" If none, you're building generic.
- Structural patterns transfer 1:1. Brand identity (palette, copy, imagery) gets replaced.`;

/**
 * Guides served by `get_style_reference({ topic })`. They hold the long-form
 * tool usage and design rules that would otherwise ride along in every
 * `tools/list` and `initialize` payload. Tool descriptions and the server
 * instructions point here with one line each.
 */
const STYLE_TOPICS = {
  design: `# Design bar

- **Typography hierarchy.** Every section needs an eyebrow or a headline. Four visible weight levels per page. If all the text is one size, the page is flat.
- **Section rhythm.** Alternate backgrounds — default, \`bg-base-200\`, a \`bg-primary\` band. Never 4+ consecutive sections on the same background.
- **Cards need padding + border + (shadow or background).** All three, or they read as unstyled divs.
- **Images need explicit width AND height** plus \`object-cover\`. Heroes tall, card images landscape.
- **Buttons need padding, font-weight, radius, background and text color.** Bare \`btn btn-primary\` with no spatial padding is a bug.
- **Forms are the most commonly broken element.** Every FormElement needs an explicit visible border against its surface, and a \`label\` prop.
- Before finishing, check each section: would a real business pay for this? If it looks like a Bootstrap demo, rebuild it.
${TECHNIQUE_TRANSFER_RULES}`,

  accessibility: `# Accessibility — mandatory, not polish

WCAG 2.1 AA.
- Every image has \`alt\` (\`""\` if decorative).
- Sequential headings, exactly one h1 per page.
- Every form input has a \`label\` prop, and \`autocomplete\` on personal-data fields.
- Icon-only buttons still need \`text\` — it becomes the accessible name.
- 4.5:1 contrast on body text, 3:1 on large text.
- Semantic container types: header, nav, section, footer, main.
- Run \`audit_accessibility\` before you call the build done, and fix everything critical or serious.`,

  domains: `# Custom domains — two halves, you own only the first

1. \`check_domain\` (or \`get_domain_status\` with \`check\`) preflights a candidate without changing anything.
2. \`set_domain\` attaches it and returns THE DNS RECORDS THE USER MUST CREATE at their registrar. Hand them back **verbatim** — targets are per-project (\`d3adb33f.vercel-dns-017.com\`, not a generic value you may remember) and a wrong one fails exactly like slow propagation.
   - Apex + www pair: both are registered. The apex needs an \`A\` record at \`@\`, \`www\` a \`CNAME\`.
   - A deeper subdomain (\`ads.example.com\`) is attached alone and needs one \`CNAME\` at its label.
   - \`redirectMode\`: \`to-apex\` (default, www → apex 308), \`to-www\` (apex → www 308), \`none\` (both serve). Change later with \`set_domain_redirect_mode\`.
3. Attaching does not publish — call \`publish_site\` too. Nothing serves until the user creates the records; re-check with \`get_domain_status\`.

Errors:
- 409: a variant is attached to another Vercel project. The user must detach it there, then retry.
- 403 with \`upgrade: true\`: past the plan's domain count (Free 1, Pro 1 per site on the subscription, Business/Agency unlimited).

Detach with \`clear_domain\` (removes both variants, resets redirectMode). \`set_domain\` never takes an empty domain. Attaching triggers a redeploy when the site is published.`,

  blocks: `# Blocks — search_blocks, apply_kit_block, list_blocks

## search_blocks
- Returns **one page**. The header shows total N and page X of Y. If Y is 1, that is the complete result set. If Y > 1, call again with \`page: 2\` (same filters) or raise \`limit\` (max 100). \`list_blocks({ category })\` lists many slugs at once.
- Pass \`categories\` / \`styles\` arrays to OR-match in one call instead of parallel searches.
- For layout intent pass \`q\` with short keywords ("split hero", "form card", "photo backdrop"); results then sort by relevance. Category-only searches default to newest; pass \`sort: "popular"\` for usage rank.
- Compare finalists by description + visual + tags. Use the slug **exactly** as shown.
- Style cohesion: filter by \`preset\` / \`style\` and pick blocks matching what's already on the page. Follow any cohesion hint at the bottom of the results.
- Results also list "Reusable from this site" sections — clone those with \`apply_kit_block({ sourceNodeId })\`.
- If filters match nothing, the server drops \`subcategory\`, then returns recent blocks. On **"Fallback — not an exact match"**, pick the closest slug and adapt copy — do not loop.

## apply_kit_block
- Exactly one source: \`slug\` (library block) or \`sourceNodeId\` (deep-clone a page section already on this site, with fresh ids and \`custom.source = { type: "site-clone", fromNodeId }\`). Cloning keeps the site coherent and is faster than searching.
- **Pass final copy in \`contentOverrides\` in the same call.** Keys are node displayNames (see \`list_block_nodes\`). Repeated names take an array, consumed in DFS order:
  \`{ "Heading": { "text": "Our Services" }, "Title": [{ "text": "SEO" }, { "text": "PPC" }, { "text": "Content" }] }\`
  Applying without overrides and then patching text leads to id-guessing loops.
- \`propOverrides\`: displayName → \`{ className, replaceClassName?, props }\`. className merges via tailwind-merge; \`replaceClassName: true\` replaces (e.g. btn-ghost vs btn-circle). Arrays for repeated names:
  \`{ "Icon isolation": { "className": "btn btn-circle bg-accent/10 text-accent", "replaceClassName": true } }\`
- Placement: default adds to \`page_home\`; \`pageId\` for other pages; \`position\` for order. \`target: "header"\` / \`"footer"\` replaces \`hdr_root\` / \`ftr_root\` with a nav/footer block (fresh \`slug\` only) — heroes and CTAs are page sections even when they sit at the top.
- Parallel section fill workers: omit \`sectionContainerId\`; the server pins the assigned section.

## Site build order
\`set_theme\` → ROOT \`company\` vars (\`patch_site_node\`) → \`apply_kit_block(target: "header")\` → page sections → \`apply_kit_block(target: "footer")\` → \`update_page\` seo.title / seo.description on every page.`,

  editing: `# Editing nodes — patch_site_node, patch_site_bulk, add_nodes, insert_node

## Patch fields
- \`classNamePatch\`: Tailwind classes merged via twMerge. Mobile-first: unprefixed = mobile, \`sm:\` 640px, \`md:\` 768px, \`lg:\` 1024px. Example: \`"flex flex-col gap-space-sm md:flex-row bg-primary text-primary-content"\`. Use \`"py-0"\` to override a wrapper's padding.
- \`propsPatch\`: non-class props (text, src, href, alt, tagName, content, icon, style, animation, action, company…).
- \`typePatch\`: swap \`type.resolvedName\` (e.g. Button → Text) without recreating the node; isCanvas follows.
- \`unsetClasses\`: classes or prefixes; \`["gap-"]\` removes gap-4, md:gap-8… (prefix match, so \`text-4xl\` also removes \`md:text-4xl\`).
- \`unsetProps\`: dotted prop paths to delete, e.g. \`["seo.jsonLd"]\`, \`["seo.favicon"]\`.
- \`nodesPatch\`: REORDER ONLY — the exact same child ids in a new order. A wrong or partial list blanks the canvas.
- Never send \`children\` or ad-hoc graphs. Patch a block's Buttons/Texts by the \`kit_*\` ids \`apply_kit_block\` returned.

## Merge semantics
\`propsPatch\` shallow-merges flat props and **deep-merges** the namespaced objects: seo, root, background, overflow, design, inject, relation, richText, theme, company. \`{ seo: { jsonLd: { image: X } } }\` keeps every sibling key. **Strings and arrays replace** — read the current value with \`get_site_node\` before editing a string you want to extend.

**Image \`src\` shadows \`content\`.** The renderer uses \`src ?? content\`; patch both to the same value or pair with \`unsetProps\`.

## Bulk
\`patch_site_bulk\` does one GET and one PUT: \`patches\` is a native JSON array (not a string) of \`{ nodeId, typePatch?, classNamePatch?, propsPatch?, nodesPatch?, unsetClasses?, unsetProps? }\`, applied in order. Prefer it for multi-node edits — parallel single patches lose updates.

## Site-wide custom code (ROOT)
\`propsPatch.inject.head\` = raw HTML in every page's \`<head>\`; \`propsPatch.inject.footer\` = raw HTML before \`</body>\`. For third-party scripts, custom CSS, chat widgets, verification tags only — never page content (invisible to the editor, SEO and static export; writes that rebuild the document are rejected). Analytics/pixels → \`set_integrations\`. Per-page head code → \`update_page\` \`headCode\`.

## add_nodes
- \`nodes\` is a flat map \`{ nodeId: node }\`; each node has \`type.resolvedName\`, \`isCanvas\`, \`props\` (className, \`custom.displayName\`), \`parent\`, \`nodes\`, \`linkedNodes: {}\`.
- \`rootNodeId\` must be in \`nodes\` and be the single top-level root; it attaches under \`parentId\` (default \`page_home\`). Multiple roots → multiple calls.
- A "Parent … does not exist in node map" warning for an existing live parent is harmless — the validator only sees the new nodes.

## insert_node
\`node\` = \`{ type: { resolvedName: "Text" }, isCanvas: false, props: { className, text, custom: { displayName } }, nodes: [] }\` — parent and linkedNodes are set for you. Lists/tables: a Container with \`props.type\` "ul" | "ol" | "li" | "table" | "thead" | "tbody" | "tfoot" | "tr" | "td" | "th".

## modifiers (add_nodes / insert_node)
\`{ Text: [{ name, classes, requires }], Container: [...] }\`, upserted into \`ROOT.props.modifiers\`. Needed only when className uses shortcut modifier names (section-heading, body-text, eyebrow, subhead, section-wrapper, card-surface, icon-row, content-col, hero-content-centered).

## Structural errors
Retry once with ids from \`list_site_nodes\` / \`search_site_nodes\` and the smallest patch. If still blocked, report the exact error and stop — never rebuild the whole site to recover.`,

  theme: `# Theme — set_theme

- Call first on a new site, before blocks. It writes the draft theme immediately. For "suggest / compare palettes" use \`suggest_palettes\`; for "pick fonts" use \`suggest_font_pairings\`. Those show choices the user applies.
- \`preset\` loads palette, fonts and styleGuide; explicit params override. By fit: bakery/restaurant → restaurant-warm / warm-editorial / rustic; SaaS → modern-minimal / notion; luxury → luxury-dark.
- Then set ROOT company variables: \`patch_site_node({ nodeId: "ROOT", propsPatch: { company: { name, tagline, phone, email, address, location, website, type } } })\`. Without them \`{{company.name}}\` shows "Acme Inc.".

## palette
Pass the **complete** list — it replaces \`ROOT.props.theme.palette\`. \`[{ name, color }]\`, colors in hex / rgb / hsl / oklch(). Use DaisyUI 5 names: Primary, Primary Content, Secondary, Secondary Content, Accent, Accent Content, Neutral, Neutral Content, Base 100, Base 200, Base 300, Base Content, Error, Error Content, Info, Info Content, Success, Success Content, Warning, Warning Content, Ring. Not "Background" / "Foreground" / "Primary Text" — those don't bind to \`bg-base-100\` / \`text-base-content\`.
\`darkPalette\`: same names, dark colors; enables dark mode.

Outline CTA pitfall: on minimal black-and-white themes keep Primary and Base Content at clearly different lightness, or \`btn-outline\` + \`text-base-content\` reads dark-on-dark.

## styleGuide (merged into the existing one; every key becomes a CSS var)
- Fonts: \`headingFontFamily\`, \`bodyFontFamily\`, optional \`accentFontFamily\` (Google Font names). Any \`*FontFamily\` key creates a var (\`displayFontFamily\` → \`--display-font-family\`). Use \`font-heading\` / \`font-body\` / \`font-accent\` on nodes — never \`font-['Name']\`, never a font \`<link>\` in inject.head.
- \`headingFont\` / \`bodyFont\`: weight class, e.g. "font-bold".
- Radius: \`radiusBox\` (0.5rem; buttons, cards), \`radiusField\` (inputs), \`radiusSelector\` (checkboxes).
- Size: \`sizeField\`, \`sizeSelector\` (0.25rem).
- \`depth\` 0 | 1, \`noise\` 0 | 1, \`border\` ("1px").
- \`buttonPadding\` ("0.75rem 1.5rem", Y X), \`containerPadding\` ("2rem 2rem"), \`contentWidth\` ("80rem", backs \`max-w-page\`).
- \`shadowStyle\` ("0 1px 3px rgba(0,0,0,0.1)").
- Inputs: \`inputBorderColor\`, \`inputBgColor\`, \`inputTextColor\`, \`inputPlaceholderColor\`, \`inputFocusRingColor\`. Links: \`linkColor\`, \`linkHoverColor\`.

\`fonts\` (\`{ url }\` or \`{ families }\`) is only a hint parsed into heading/body families when styleGuide omits them. \`jsonLd\` is a schema.org object; \`{{company.*}}\` variables work inside it.`,

  pages: `# Pages — add_page, update_page, delete_page

- A page is a Container with \`props.type: "page"\` directly under ROOT (beside header and footer). The display name becomes the slug: "Our Services" → /our-services. The first page is home.
- **Set \`seo.title\` and \`seo.description\` on every page.** A page without \`seo.title\` falls back to the site-level title — never to its display name — so every page ships the same \`<title>\`. The site-level title/description are edited with \`update_site\` and read with \`select_site\`.
- \`seo.jsonLd\` is one schema.org object (FAQPage, Article, BreadcrumbList); \`seo.schema\` is an array, one \`<script type="application/ld+json">\` each.
- \`headCode\`: raw HTML in this page's \`<head>\`, emitted server-side so scripts run at parse time. \`bodyClass\`: classes on \`<body>\` for this page. Empty string clears either. Third-party code only, never page content. Site-wide code → ROOT \`inject.head\` / \`inject.footer\`; analytics → \`set_integrations\`.
- Chrome: \`hideHeader\` / \`hideFooter\` suppress the global header / footer. \`hideChrome\` strips ALL ROOT-level chrome (header, footer, sticky bars, floating CTAs, drawers) — the switch for ad landing pages.
- \`isHidden\` pages are not reachable by URL. You can't delete the last page; deleting home promotes the next page.`,

  media: `# Media — upload_image, upload_file, set_favicon

Sources, best first:
1. \`filePath\` — **local stdio server only** (the hosted server rejects it). Best for files on disk at any size: bytes go straight to the CDN, EXIF rotation applied, AVIF/HEIC become JPEG, wider than 2680px is downscaled. Pass an array to upload many.
2. \`imageUrl\` / \`fileUrl\` — a public URL. Pass the ORIGINAL full-resolution URL, never one with \`?w=\` / \`h=\` / \`q=\` resize params (that stores a permanently downscaled copy).
3. \`dataBase64\` — last resort. The serverless request cap is 4.5MB, so ~3MB decoded, and it costs ~1.4 tokens per byte. Pass \`mimeType\` for non-images so they route to R2.

Using the result:
- Images: Image node \`type: "cdn"\` with the bare mediaId in \`src\` — never the raw url. If the node also has \`content\`, patch both (\`src\` shadows \`content\`).
- Video/audio/pdf/zip (R2): the public url works in a Link or a collection url/media field; a Video node uses \`provider: "r2"\`, \`videoId\` = mediaId.

Favicon (\`set_favicon\`): exactly one of \`filePath\` (stdio), \`mediaId\`, \`imageUrl\`, \`dataBase64\`, \`svgContent\` (only SVG markup the user supplied — never invent it), or \`clear: true\`. Best input: a 512px square PNG or an SVG; \`.ico\` can't be stored. Written to \`ROOT.props.seo.favicon\`, staged like any edit (publish to see it live); browsers cache favicons hard. Sites only, not templates.`,

  integrations: `# Integrations — set_integrations

Providers (rendered as real tags on published pages):
- \`googleAnalytics\`: GA4 id \`G-XXXXXXXXXX\` (Admin → Data Streams).
- \`googleTagManager\`: \`GTM-XXXXXXX\`. With GTM, configure tags inside GTM and pass only the container id here.
- \`googleSearchConsole\`: the verification content value, not the whole meta tag.
- \`metaPixel\`: Meta Pixel id.
- \`googleAds\`: \`AW-XXXXXXXXXX\`. Shares the gtag.js loader with GA4.

Per-action conversions: with \`googleAds\` set, give a Button/Link/Form action \`conversion: { provider: "google-ads", eventName: "conversion", sendTo: "AW-XXX/YYY" }\`. GA4 and Meta wire automatically once their ids are set.

Anything else (chat widgets, A/B testing, CRMs, custom scripts): \`patch_site_node\` on ROOT with \`propsPatch.inject.head\` / \`inject.footer\` — third-party snippets only. Per-page head code: \`update_page\` \`headCode\`.`,

  "section-tree": `# place_section_tree (clone-pipeline fill mode only)

Submit the COMPLETE nested hierarchy for your assigned section in ONE call. The server reads the section from the fill context and generates stable ids; a second call REPLACES the first, so retries are safe.

\`\`\`
{
  reason: "hero split with form card",
  hierarchy: {
    type: "Container",
    props: { className: "flex flex-col w-full py-space-lg px-container-x bg-base-100" },
    children: [
      { type: "Text",   props: { tagName: "h1", text: "Source heading verbatim", className: "text-4xl font-heading font-bold" } },
      { type: "Text",   props: { tagName: "p",  text: "Source subhead verbatim",  className: "text-base-content/80" } },
      { type: "Button", props: { text: "Get started", action: [{ type: "link", href: "https://example.com" }] } },
      { type: "Container", props: { className: "grid grid-cols-3 gap-space-md" }, children: [ ... ] }
    ]
  }
}
\`\`\`

Rules:
- \`hierarchy\` is an object (not a string, not an array); the root is a Container.
- Every node has \`type\` + \`props\`; containers nest \`children\` arrays. Never a flat map.
- Never invent Image.src — use deliveryURLs from the media map in your prompt.
- Buttons: short label in \`props.text\`, URL in the action's \`href\`, never in the text.
- After success, only use \`patch_site_bulk\` for className / text refinements on the returned ids.`,
};

const STYLE_TOPIC_LABELS = {
  design: "design bar + transferring techniques from a reference",
  accessibility: "WCAG AA checklist",
  domains: "set_domain, DNS records, redirect modes, errors",
  blocks: "search_blocks + apply_kit_block usage, overrides, build order",
  editing: "patch fields, merge semantics, custom code, add_nodes / insert_node shapes",
  theme: "set_theme palette names, styleGuide keys, fonts, company vars",
  pages: "page SEO, headCode / bodyClass, hiding header/footer",
  media: "upload sources, using mediaIds, favicons",
  integrations: "analytics ids, per-action conversions",
  "section-tree": "place_section_tree shape (clone fill mode)",
};

// The enum on get_style_reference.topic in tools.json must list these names.
const STYLE_TOPIC_NAMES = Object.keys(STYLE_TOPICS);

const STYLE_TOPIC_INDEX = `
## More guides — get_style_reference({ topic })

${STYLE_TOPIC_NAMES.map(t => `- \`${t}\` — ${STYLE_TOPIC_LABELS[t]}`).join("\n")}
`;

module.exports = { STYLE_REFERENCE, STYLE_TOPICS, STYLE_TOPIC_NAMES, STYLE_TOPIC_INDEX };
