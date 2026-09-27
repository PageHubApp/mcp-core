const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { parseMaybeJson, mergeStrList } = require("../helpers/index.js");
const { buildButtonClassFramework, validateButtonClasses } = require("../validation/button-system");
const { STYLE_REFERENCE, STYLE_TOPICS, STYLE_TOPIC_NAMES, STYLE_TOPIC_INDEX } = require("../data/style-reference");

// Limits for compactComponentSchemaForFill — keeps schema payloads small for
// parallel fill context windows without losing essential prop information.
const MAX_SCHEMA_PROPS = 28;
const MAX_DESCRIPTION_LENGTH = 160;
const MAX_ENUM_VALUES = 12;

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

  async get_style_reference(args) {
    const topic = args?.topic;
    if (!topic) {
      return { content: [{ type: "text", text: STYLE_REFERENCE + STYLE_TOPIC_INDEX }] };
    }
    const guide = STYLE_TOPICS[topic];
    if (!guide) {
      return {
        content: [{ type: "text", text: `Unknown topic "${topic}". Valid topics: ${STYLE_TOPIC_NAMES.join(", ")}.` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: guide }] };
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
