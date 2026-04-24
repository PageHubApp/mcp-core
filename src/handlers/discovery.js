const { apiFetch } = require("../api-fetch");
const { getContext } = require("../context");
const { parseMaybeJson, mergeStrList } = require("../helpers");
const { buildButtonClassFramework, validateButtonClasses } = require("../button-system");

// Limits for compactComponentSchemaForFill — keeps schema payloads small for
// parallel fill context windows without losing essential prop information.
const MAX_SCHEMA_PROPS = 28;
const MAX_DESCRIPTION_LENGTH = 160;
const MAX_ENUM_VALUES = 12;

/* ── Style reference ── */

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
5. **Palette (outline CTAs):** On minimal monochrome themes, Primary and Base Content must differ in lightness — not both the same near-black OKLCH. DaisyUI 5 btn-outline uses --btn-color for label/border; if primary ≈ base-content, canonical outline + text-base-content can collapse to illegible dark-on-dark. Fix palette (and styleGuide linkColor/inputTextColor if Base Content changes). Reference: scripts/seed/data/templates/acme.json, THEME-SYSTEM.md.
6. Use descriptive node IDs: "sec_hero", "hero_title", etc.
7. **All styling uses props.className** — a single Tailwind class string. Mobile-first: unprefixed utilities apply at all widths; **md:** = 768px+; **lg:** = 1024px+. Example: "flex flex-col gap-4 py-8 md:flex-row md:gap-8 bg-primary text-primary-content". Use **classNamePatch** in patch tools to merge classes via twMerge. Use **propsPatch** only for non-class props (text, src, href, style, animation). See **BLOCKS-AI-CONTEXT.md**.
`;

/* ── Design patterns (lazy-loaded) ── */

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

/** Shrink schema JSON for parallel fills — full props enums blow context (100k+ tokens). */
function compactComponentSchemaForFill(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const propsIn = schema.props || {};
  const propsOut = {};
  const keys = Object.keys(propsIn);
  for (let i = 0; i < keys.length && i < MAX_SCHEMA_PROPS; i++) {
    const k = keys[i];
    const v = propsIn[k];
    if (!v || typeof v !== "object") {
      propsOut[k] = v;
      continue;
    }
    propsOut[k] = {
      type: v.type,
      description:
        typeof v.description === "string"
          ? v.description.slice(0, MAX_DESCRIPTION_LENGTH)
          : v.description,
    };
    if (Array.isArray(v.enum) && v.enum.length) {
      propsOut[k].enum =
        v.enum.length <= MAX_ENUM_VALUES ? v.enum : v.enum.slice(0, MAX_ENUM_VALUES).concat(["…"]);
    }
    if (v.default !== undefined) propsOut[k].default = v.default;
  }
  if (keys.length > MAX_SCHEMA_PROPS) {
    propsOut._truncatedPropKeys = keys.length - MAX_SCHEMA_PROPS;
  }
  return {
    name: schema.name,
    description: schema.description,
    requiredProps: schema.requiredProps,
    supportsChildren: schema.supportsChildren,
    childrenType: schema.childrenType,
    props: propsOut,
  };
}

/* ── Handlers ── */

module.exports = {
  async list_blocks(args) {
    const ctx = getContext();
    let categories = mergeStrList(args.category, args.categories);
    let styles = mergeStrList(args.style, args.styles);
    if (styles.length === 0 && ctx.buildStyle) styles = [ctx.buildStyle];

    const params = { limit: "200" };
    if (categories.length === 1) params.category = categories[0];
    else if (categories.length > 1) params.category = categories.join(",");
    if (styles.length === 1) params.style = styles[0];
    else if (styles.length > 1) params.style = styles.join(",");
    const qs = new URLSearchParams(params).toString();
    const data = await apiFetch(`/api/v1/components?${qs}`);
    const components = data.components || [];

    if (components.length === 0) {
      return { content: [{ type: "text", text: "No block templates found." }] };
    }

    const byCategory = {};
    for (const comp of components) {
      const cat = comp.category || "uncategorized";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(comp);
    }

    const result = [];
    for (const [cat, templates] of Object.entries(byCategory)) {
      result.push(`\n## ${cat}`);
      for (const tpl of templates) {
        const visual = tpl.visual ? `\nVisual: ${tpl.visual}` : "";
        const tags = tpl.tags?.length ? `\nTags: ${tpl.tags.join(", ")}` : "";
        result.push(`\n### ${tpl.slug} — "${tpl.name}"${visual}${tags}`);
      }
    }

    const noStyleWarn =
      !ctx.buildStyle && !ctx.fillMode
        ? `\n\n*(No buildStyle on context — call \`set_theme({ preset })\` BEFORE list_blocks so results are filtered to the theme's visual family. Picking blocks now means defaults instead of style-matched picks.)*`
        : "";
    return {
      content: [
        {
          type: "text",
          text: `# Available Block Templates\n\nUse these slugs with apply_kit_block(slug).${noStyleWarn}\n${result.join("\n")}`,
        },
      ],
    };
  },

  async get_component_schema(args) {
    const fillMode = !!getContext().fillMode;
    // Accept single component, comma-separated list, or omit for all
    const requested = args.components || args.component;
    if (requested) {
      const names = requested
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      const schemas = {};
      for (const name of names) {
        const data = await apiFetch(`/api/v1/schemas?component=${encodeURIComponent(name)}`);
        if (!data.error) {
          schemas[name] = fillMode ? compactComponentSchemaForFill(data.schema) : data.schema;
        }
      }
      if (Object.keys(schemas).length === 0) {
        return { content: [{ type: "text", text: `No schemas found for: ${names.join(", ")}` }] };
      }
      const note = fillMode
        ? "\n\n(Fill mode: prop lists are truncated — ask for a specific component again if you need more detail.)\n"
        : "";
      return { content: [{ type: "text", text: `${JSON.stringify(schemas, null, 2)}${note}` }] };
    }
    if (fillMode) {
      return {
        content: [
          {
            type: "text",
            text:
              "In parallel fill, omitting `components` is not supported — pass a comma list (e.g. `Container,Text,Button`). " +
              "Prefer `search_blocks` + `apply_kit_block` instead of loading all schemas.",
          },
        ],
      };
    }
    const data = await apiFetch("/api/v1/schemas");
    return { content: [{ type: "text", text: JSON.stringify(data.schemas, null, 2) }] };
  },

  async get_style_reference() {
    return { content: [{ type: "text", text: STYLE_REFERENCE }] };
  },

  async generate_button_classes(args) {
    const out = buildButtonClassFramework(args || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              className: out.className,
              activeModifiers: out.activeModifiers,
              variant: out.variant,
              note: "Framework output: canonical starter classes + modifiers. You can append custom classes; run validate_button_classes before patch/save.",
            },
            null,
            2
          ),
        },
      ],
    };
  },

  async validate_button_classes(args) {
    const out = validateButtonClasses(args || {});
    return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
  },

  async list_presets(args) {
    const a = args && typeof args === "object" ? args : {};
    const qs = a.mood ? `?mood=${encodeURIComponent(a.mood)}` : "";
    const data = await apiFetch(`/api/v1/presets${qs}`);
    const presets = data.presets || [];

    if (presets.length === 0) {
      return { content: [{ type: "text", text: "No presets found." }] };
    }

    // compact / brief: id + human name only (planner default via agent) — saves thousands of tokens vs description blurbs
    const useCompact = a.compact === true || a.brief === true;
    if (useCompact) {
      const lines = presets.map(p => `• \`${p.presetId}\` — ${p.name || p.presetId}`);
      return {
        content: [
          {
            type: "text",
            text:
              "# Theme presets (compact)\n\n" +
              'Use `set_theme({ preset: "preset-id" })`. Full palette/fonts load from the preset.\n\n' +
              `${lines.join("\n")}\n\n` +
              "Pass `{ compact: false }` if you need longer descriptions per preset.",
          },
        ],
      };
    }

    const lines = presets.map(p => {
      const desc = (p.description || "").replace(/\s+/g, " ").trim();
      const short = desc.length > 140 ? `${desc.slice(0, 137)}…` : desc;
      return `• \`${p.presetId}\` — **${p.name}** — ${short}`;
    });
    return {
      content: [
        {
          type: "text",
          text:
            '# Theme Presets\n\nUse `set_theme({ preset: "preset-id" })`. One line per preset — pick by name/mood; full palette loads from the preset.\n\n' +
            `${lines.join("\n")}`,
        },
      ],
    };
  },
};
