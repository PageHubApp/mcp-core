const { apiFetch } = require("../core/api-fetch");
const { buildButtonClassFramework, validateButtonClasses } = require("../validation/button-system");
const { STYLE_REFERENCE, STYLE_TOPICS, STYLE_TOPIC_NAMES, STYLE_TOPIC_INDEX } = require("../data/style-reference");

/* ── Handlers ── */

module.exports = {
  async get_style_reference(args) {
    const topic = args?.topic;
    // Generated on the server from the renderer's own tag / filter / object catalogue, so it can't drift from what
    // renders (app repo utils/htmlFirst/liquidReference.ts).
    if (topic === "liquid") {
      const { text } = await apiFetch("/api/v1/format/liquid");
      return { content: [{ type: "text", text }] };
    }
    if (!topic) {
      return { content: [{ type: "text", text: STYLE_REFERENCE + STYLE_TOPIC_INDEX }] };
    }
    const guide = STYLE_TOPICS[topic];
    if (!guide) {
      return {
        content: [{ type: "text", text: `Unknown topic "${topic}". Valid topics: ${[...STYLE_TOPIC_NAMES, "liquid"].join(", ")}.` }],
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
              note: "Framework output: canonical starter classes + modifiers. You can append custom classes; run validate_button_classes before writing it into a file.",
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
