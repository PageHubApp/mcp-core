const { apiFetch } = require('../api-fetch');
const { parseMaybeJson } = require('../helpers');

/* ── Style reference ── */

const STYLE_REFERENCE = `# PageHub Style Reference

## Palette CSS Variables (set via set_theme palette array)

| Variable | Slot | Typical Use |
|----------|------|-------------|
| var(--ph-primary) | 0 | Main brand color (buttons, links, hero backgrounds) |
| var(--ph-primary-text) | 1 | Text on primary backgrounds |
| var(--ph-secondary) | 2 | Supporting color (cards, badges, secondary buttons) |
| var(--ph-secondary-text) | 3 | Text on secondary backgrounds |
| var(--ph-accent) | 4 | CTA/highlight color (call-to-action buttons, emphasis) |
| var(--ph-accent-text) | 5 | Text on accent backgrounds |
| var(--ph-neutral) | 6 | Muted color (borders, disabled, subtle backgrounds) |
| var(--ph-neutral-text) | 7 | Text on neutral backgrounds |
| var(--ph-background) | 8 | Page/site background |
| var(--ph-text) | 9 | Default body text |
| var(--ph-alternate-background) | 10 | Alternate section backgrounds, cards, dividers |
| var(--ph-alternate-text) | 11 | Text on alternate backgrounds |

## Style Guide CSS Variables (set via set_theme styleGuide)

| Variable | Key | Default |
|----------|-----|---------|
| --ph-border-radius | borderRadius | 0.5rem |
| --ph-button-padding-x / -y | buttonPadding | 1.5rem 0.75rem |
| --ph-container-padding / -x / -y | containerPadding | 2rem 2rem |
| --ph-section-gap | sectionGap | 4rem |
| --ph-container-gap | containerGap | 1.5rem |
| --ph-content-width | contentWidth | 80rem |
| --ph-shadow-style | shadowStyle | 0 1px 3px rgba(0,0,0,0.1) |
| --ph-heading-font-family | headingFontFamily | (from Google Fonts) |
| --ph-body-font-family | bodyFontFamily | (from Google Fonts) |

## Using Variables in Props

ALWAYS use CSS variables via Tailwind arbitrary syntax — never hardcode hex or named colors:

  root.background: "bg-(--ph-primary)"
  root.color: "text-(--ph-primary-text)"
  root.borderColor: "border-(--ph-alternate-background)"
  root.radius: "rounded-(--ph-border-radius)"
  mobile.gap: "gap-(--ph-container-gap)"
  mobile.maxWidth: "max-w-(--ph-content-width)"

Exception: bg-transparent, bg-white/10 (opacity modifiers) are OK.

## Responsive Pattern (Mobile-First)

props.mobile = base styles (no Tailwind prefix)
props.desktop = md: prefixed styles (auto-applied)

## Layout Prop Keys (in mobile/desktop objects)

display, flexDirection, gridCols, gap, alignItems, justifyContent,
width, maxWidth, height, minHeight, py, px, mx, position, inset, zIndex, overflow, flex

## Visual Prop Keys (in root object)

background, color, border, borderColor, radius, shadow,
fontSize, fontWeight, fontFamily, textAlign, lineHeight, textDecoration

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
4. Always match text color to background: bg-(--ph-primary) → text-[var(--ph-primary-text)].
5. Use descriptive node IDs: "sec_hero", "hero_title", etc.
`;

/* ── Design patterns (lazy-loaded) ── */

function getDesignPatterns() {
  return require('../data/patterns');
}

/* ── Handlers ── */

module.exports = {
  async list_sections(args) {
    const params = { limit: '200' };
    if (args.category) params.category = args.category;
    const qs = new URLSearchParams(params).toString();
    const data = await apiFetch(`/api/v1/components?${qs}`);
    const components = data.components || [];

    if (components.length === 0) {
      return { content: [{ type: 'text', text: 'No section templates found.' }] };
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
        text: `# Available Section Templates\n\nUse these IDs with add_section(templateId). Override content/styling by displayName.\n${result.join('\n')}`,
      }],
    };
  },

  async get_component_schema(args) {
    if (args.component) {
      const data = await apiFetch(`/api/v1/schemas?component=${encodeURIComponent(args.component)}`);
      if (data.error) return { content: [{ type: 'text', text: data.error }] };
      return { content: [{ type: 'text', text: JSON.stringify({ [args.component]: data.schema }, null, 2) }] };
    }
    const data = await apiFetch('/api/v1/schemas');
    return { content: [{ type: 'text', text: JSON.stringify(data.schemas, null, 2) }] };
  },

  async get_style_reference() {
    return { content: [{ type: 'text', text: STYLE_REFERENCE }] };
  },

  async get_design_patterns(args) {
    const patterns = getDesignPatterns();
    if (args.pattern) {
      const pattern = patterns[args.pattern];
      if (!pattern) return { content: [{ type: 'text', text: `Unknown pattern: "${args.pattern}". Available: ${Object.keys(patterns).join(', ')}` }] };
      return { content: [{ type: 'text', text: `# Design Pattern: ${args.pattern}\n\n${pattern.description}\n\n**Usage:** ${pattern.usage}\n\n## Node Map\n\nPass this to add_custom_section(slug, sectionRootId: "${Object.keys(pattern.nodes)[0]}", nodes: <the nodes below>).\n\n\`\`\`json\n${JSON.stringify(pattern.nodes, null, 2)}\n\`\`\`` }] };
    }
    const summary = Object.entries(patterns).map(([k, v]) => `### ${k}\n${v.description}`).join('\n\n');
    return { content: [{ type: 'text', text: `# Design Patterns\n\nCall get_design_patterns(pattern: "name") to get the full node map for any pattern.\n\n${summary}` }] };
  },

  async list_presets(args) {
    const qs = args.mood ? `?mood=${encodeURIComponent(args.mood)}` : '';
    const data = await apiFetch(`/api/v1/presets${qs}`);
    const presets = data.presets || [];

    if (presets.length === 0) {
      return { content: [{ type: 'text', text: 'No presets found.' }] };
    }

    const lines = presets.map(p => {
      const palettePreview = p.palette.slice(0, 6).map(c => `${c.name}: ${c.color}`).join(', ');
      return `### ${p.presetId}\n**${p.name}** — ${p.description}\nMoods: ${(p.mood || []).join(', ')}\nFonts: heading=${p.styleGuide?.headingFontFamily || '?'}, body=${p.styleGuide?.bodyFontFamily || '?'}\nPalette: ${palettePreview}\nRadius: ${p.styleGuide?.borderRadius || '?'} | Shadow: ${p.styleGuide?.shadowStyle || 'none'}`;
    });
    return {
      content: [{
        type: 'text',
        text: `# Theme Presets\n\nUse with set_theme(preset: "preset-id"). Individual palette/fonts/styleGuide params override preset values.\n\n${lines.join('\n\n')}`,
      }],
    };
  },
};
