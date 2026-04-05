const { apiFetch } = require('../api-fetch');
const { getContext } = require('../context');
const { parseMaybeJson } = require('../helpers');

/* ── Style reference ── */

const STYLE_REFERENCE = `# PageHub Style Reference

## Palette CSS Variables (set via set_theme palette array)

| Variable | Slot | Typical Use |
|----------|------|-------------|
| var(--primary) | 0 | Main brand color (buttons, links, hero backgrounds) |
| var(--primary-foreground) | 1 | Text on primary backgrounds |
| var(--secondary) | 2 | Supporting color (cards, badges, secondary buttons) |
| var(--secondary-foreground) | 3 | Text on secondary backgrounds |
| var(--accent) | 4 | CTA/highlight color (call-to-action buttons, emphasis) |
| var(--accent-foreground) | 5 | Text on accent backgrounds |
| var(--muted) | 6 | Muted color (borders, disabled, subtle backgrounds) |
| var(--muted-foreground) | 7 | Text on neutral backgrounds |
| var(--background) | 8 | Page/site background |
| var(--foreground) | 9 | Default body text (shadcn slot \"Foreground\"; not --text) |
| var(--card) | 10 | Alternate section backgrounds, cards, dividers |
| var(--card-foreground) | 11 | Text on alternate / card surfaces |

## Style Guide CSS Variables (set via set_theme styleGuide)

| Variable | Key | Default |
|----------|-----|---------|
| --radius | borderRadius | 0.5rem |
| --button-padding-x / -y | buttonPadding | 1.5rem 0.75rem |
| --container-padding / -x / -y | containerPadding | 2rem 2rem |
| --section-gap | sectionGap | 4rem |
| --container-gap | containerGap | 1.5rem |
| --content-width | contentWidth | 80rem |
| --shadow-style | shadowStyle | 0 1px 3px rgba(0,0,0,0.1) |
| --heading-font-family | headingFontFamily | (from Google Fonts) |
| --body-font-family | bodyFontFamily | (from Google Fonts) |

## Using Variables in className

ALWAYS use CSS variables via Tailwind token syntax in className — never hardcode hex or named colors:

  "bg-(--primary) text-(--primary-foreground) border-(--card) rounded-(--radius) gap-(--container-gap) max-w-(--content-width)"

Exception: bg-transparent, bg-white/10 (opacity modifiers) are OK.

## Responsive Pattern (Mobile-First className)

All styling in a single props.className string:
- Unprefixed = base/mobile styles
- md: prefix = desktop (768px+)
- lg: prefix = large screens (1024px+)

Example: "flex flex-col gap-4 py-16 bg-(--background) text-(--foreground) md:flex-row md:gap-8 md:py-24"

## Common className Utilities

Layout: flex, flex-col, flex-row, grid, grid-cols-*, gap-*, items-*, justify-*,
  w-full, w-1/2, max-w-(--content-width), h-[400px], min-h-screen,
  py-*, px-*, mx-auto, relative, absolute, z-*, overflow-hidden

Surface: bg-(--primary), text-(--foreground), border, border-(--card),
  rounded-(--radius), shadow-sm, shadow-md

Typography: text-4xl, font-bold, leading-relaxed, tracking-widest, uppercase

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

## Key Rules

1. Page containers (type: "page") must NOT have gap, py, px, p, my, mx — spacing goes on sections.
2. ROOT node must NOT have gap or spacing.
3. Text "text" values: NO block tags. Only inline: <strong>, <em>, <br/>, <span>, <a>, <ul>/<li>.
4. Always match text color to background: bg-(--primary) → text-(--primary-foreground); bg-(--background) → text-(--foreground).
5. Use descriptive node IDs: "sec_hero", "hero_title", etc.
6. **All styling uses props.className** — a single Tailwind class string. Mobile-first: unprefixed utilities apply at all widths; **md:** = 768px+; **lg:** = 1024px+. Example: "flex flex-col gap-4 py-8 md:flex-row md:gap-8 bg-(--primary) text-(--primary-foreground)". Use **classNamePatch** in patch tools to merge classes via twMerge. Use **propsPatch** only for non-class props (text, src, href, style, animation). See **BLOCKS-AI-CONTEXT.md**.
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
  - Background images with gradient overlays — prefer **backgroundOverlay** on Container with **backgroundImage**; avoid root.style in block/kit JSON.
  - Section background rhythm — alternate white/tinted/white/dark, never 4+ same bg
  - Background overlays: use "backgroundOverlay" prop. Presets: "dark-left", "dark-right", "dark-bottom", "dark-top", "dark", "light". Custom: { direction: "to right", from: { color: "#000", opacity: 85 }, to: { color: "#000", opacity: 20 } }
  - For ad-hoc editor sites only (not library blocks): root.style may be used for backdrop-filter, rgba fills, etc. — never for image overlays (use backgroundOverlay).
- Before building each section: check "which extracted techniques am I applying here?" If none, you're building generic.
- Structural patterns transfer 1:1. Brand identity (palette, copy, imagery) gets replaced.`;

function getDesignPatterns() {
  return require('../data/patterns');
}

/** Shrink schema JSON for parallel fills — full props enums blow context (100k+ tokens). */
function compactComponentSchemaForFill(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const propsIn = schema.props || {};
  const propsOut = {};
  const keys = Object.keys(propsIn);
  const maxProps = 28;
  for (let i = 0; i < keys.length && i < maxProps; i++) {
    const k = keys[i];
    const v = propsIn[k];
    if (!v || typeof v !== 'object') {
      propsOut[k] = v;
      continue;
    }
    propsOut[k] = {
      type: v.type,
      description: typeof v.description === 'string' ? v.description.slice(0, 160) : v.description,
    };
    if (Array.isArray(v.enum) && v.enum.length) {
      propsOut[k].enum = v.enum.length <= 12 ? v.enum : v.enum.slice(0, 12).concat(['…']);
    }
    if (v.default !== undefined) propsOut[k].default = v.default;
  }
  if (keys.length > maxProps) {
    propsOut._truncatedPropKeys = keys.length - maxProps;
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
    const params = { limit: '200' };
    if (args.category) params.category = args.category;
    const qs = new URLSearchParams(params).toString();
    const data = await apiFetch(`/api/v1/components?${qs}`);
    const components = data.components || [];

    if (components.length === 0) {
      return { content: [{ type: 'text', text: 'No block templates found.' }] };
    }

    const byCategory = {};
    for (const comp of components) {
      const cat = comp.category || 'uncategorized';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(comp);
    }

    const result = [];
    for (const [cat, templates] of Object.entries(byCategory)) {
      result.push(`\n## ${cat}`);
      for (const tpl of templates) {
        const visual = tpl.visual ? `\nVisual: ${tpl.visual}` : '';
        const tags = tpl.tags?.length ? `\nTags: ${tpl.tags.join(', ')}` : '';
        result.push(`\n### ${tpl.slug} — "${tpl.name}"${visual}${tags}`);
      }
    }

    return {
      content: [{
        type: 'text',
        text: `# Available Block Templates\n\nUse these IDs with add_block(templateId). Override content/styling by displayName.\n${result.join('\n')}`,
      }],
    };
  },

  async get_component_schema(args) {
    const fillMode = !!getContext().fillMode;
    // Accept single component, comma-separated list, or omit for all
    const requested = args.components || args.component;
    if (requested) {
      const names = requested.split(',').map(s => s.trim()).filter(Boolean);
      const schemas = {};
      for (const name of names) {
        const data = await apiFetch(`/api/v1/schemas?component=${encodeURIComponent(name)}`);
        if (!data.error) {
          schemas[name] = fillMode ? compactComponentSchemaForFill(data.schema) : data.schema;
        }
      }
      if (Object.keys(schemas).length === 0) {
        return { content: [{ type: 'text', text: `No schemas found for: ${names.join(', ')}` }] };
      }
      const note = fillMode
        ? '\n\n(Fill mode: prop lists are truncated — ask for a specific component again if you need more detail.)\n'
        : '';
      return { content: [{ type: 'text', text: `${JSON.stringify(schemas, null, 2)}${note}` }] };
    }
    if (fillMode) {
      return {
        content: [{
          type: 'text',
          text:
            'In parallel fill, omitting `components` is not supported — pass a comma list (e.g. `Container,Text,Button`). ' +
            'Prefer `search_blocks` + `apply_kit_block` instead of loading all schemas.',
        }],
      };
    }
    const data = await apiFetch('/api/v1/schemas');
    return { content: [{ type: 'text', text: JSON.stringify(data.schemas, null, 2) }] };
  },

  async get_style_reference() {
    return { content: [{ type: 'text', text: STYLE_REFERENCE }] };
  },

  async get_design_patterns(args) {
    const patterns = getDesignPatterns();
    const fillMode = !!getContext().fillMode;
    if (args.pattern) {
      // Aliases for common section type names
      const ALIASES = { footer: 'structured-footer', gallery: 'bento-gallery', testimonials: 'quote-testimonials', services: 'offering-list', menu: 'offering-list', contact: 'rich-contact' };
      const key = ALIASES[args.pattern] || args.pattern;
      const pattern = patterns[key];
      if (!pattern) return { content: [{ type: 'text', text: `Unknown pattern: "${args.pattern}". Available: ${Object.keys(patterns).join(', ')}` }] };
      // Parallel section fills: full node maps are huge and slow — kit path should win; keep recipe text only.
      if (fillMode) {
        const roots = Object.keys(pattern.nodes || {});
        const rootLine = roots.length
          ? `\n**Top-level node ids in this recipe:** ${roots.slice(0, 8).join(', ')}${roots.length > 8 ? ', ...' : ''}\n`
          : '';
        return {
          content: [{
            type: 'text',
            text:
              `# Design pattern (summary only): ${key}\n\n${pattern.description}\n\n**Usage:** ${pattern.usage}${rootLine}\n` +
              `**Parallel fill:** You should already have tried \`search_blocks\` + \`apply_kit_block\`. Full JSON node map is omitted here (too large). ` +
              `If no kit block worked, use \`get_component_schema\` + \`add_nodes\` and follow the usage above — do not wait for a full map dump.`,
          }],
        };
      }
      return { content: [{ type: 'text', text: `# Design Pattern: ${args.pattern}\n\n${pattern.description}\n\n**Usage:** ${pattern.usage}\n\n## Node Map\n\nPass this to add_custom_section(slug, sectionRootId: "${Object.keys(pattern.nodes)[0]}", nodes: <the nodes below>).\n\n\`\`\`json\n${JSON.stringify(pattern.nodes, null, 2)}\n\`\`\`` }] };
    }
    const summary = Object.entries(patterns).map(([k, v]) => `### ${k}\n${v.description}`).join('\n\n');
    return { content: [{ type: 'text', text: `# Design Patterns\n\nCall get_design_patterns(pattern: "name") to get the full node map for any pattern.\n\n${summary}\n\n${TECHNIQUE_TRANSFER_RULES}` }] };
  },

  async list_presets(args) {
    const a = args && typeof args === 'object' ? args : {};
    const qs = a.mood ? `?mood=${encodeURIComponent(a.mood)}` : '';
    const data = await apiFetch(`/api/v1/presets${qs}`);
    const presets = data.presets || [];

    if (presets.length === 0) {
      return { content: [{ type: 'text', text: 'No presets found.' }] };
    }

    // compact / brief: id + human name only (planner default via agent) — saves thousands of tokens vs description blurbs
    const useCompact = a.compact === true || a.brief === true;
    if (useCompact) {
      const lines = presets.map((p) => `• \`${p.presetId}\` — ${p.name || p.presetId}`);
      return {
        content: [{
          type: 'text',
          text:
            '# Theme presets (compact)\n\n' +
            'Use `set_theme({ preset: "preset-id" })`. Full palette/fonts load from the preset.\n\n' +
            `${lines.join('\n')}\n\n` +
            'Pass `{ compact: false }` if you need longer descriptions per preset.',
        }],
      };
    }

    const lines = presets.map((p) => {
      const desc = (p.description || '').replace(/\s+/g, ' ').trim();
      const short = desc.length > 140 ? `${desc.slice(0, 137)}…` : desc;
      return `• \`${p.presetId}\` — **${p.name}** — ${short}`;
    });
    return {
      content: [{
        type: 'text',
        text:
          '# Theme Presets\n\nUse `set_theme({ preset: "preset-id" })`. One line per preset — pick by name/mood; full palette loads from the preset.\n\n' +
          `${lines.join('\n')}`,
      }],
    };
  },
};
