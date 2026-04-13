/**
 * Node validation & auto-fix for CraftJS flat node maps.
 *
 * Runs before save_site / add_custom_block / add_nodes to catch
 * common authoring mistakes that cause silent rendering failures.
 *
 * Returns { warnings: string[], fixes: string[], errors: string[] }.
 * - warnings: non-blocking notes (hardcoded colors, missing displayName)
 * - fixes: auto-applied corrections (src→content, bare text wrapping, missing tagName)
 * - errors: blocking issues that prevent save (broken parent refs, etc.)
 */

// ── Hardcoded color detection ──

const HARDCODED_COLOR_RE =
  /(?:^|\s)(?:bg|text|border|ring|shadow|outline|divide|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/g;
const SLATE_COLOR_RE =
  /(?:^|\s)(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?/g;

const DAISY_TOKEN_MAP = {
  "bg-": "bg-base-100 / bg-base-200 / bg-primary / bg-secondary / bg-accent / bg-neutral",
  "text-":
    "text-base-content / text-primary-content / text-secondary-content / text-neutral-content",
  "border-": "border-base-200 / border-base-300 / border-primary / border-neutral",
};

function detectHardcodedColors(className) {
  if (!className || typeof className !== "string") return [];
  const matches = [];
  const hexMatches = className.match(HARDCODED_COLOR_RE);
  if (hexMatches) {
    for (const m of hexMatches) {
      const prefix = m.trim().split("-")[0] + "-";
      const suggestion = DAISY_TOKEN_MAP[prefix] || "use DaisyUI semantic tokens";
      matches.push({ class: m.trim(), suggestion });
    }
  }
  // Only flag named Tailwind colors used as primary surface/text colors
  // (not opacity modifiers like bg-white/10 which are fine)
  const namedMatches = className.match(SLATE_COLOR_RE);
  if (namedMatches) {
    for (const m of namedMatches) {
      const prefix = m.trim().split("-")[0] + "-";
      const suggestion = DAISY_TOKEN_MAP[prefix] || "use DaisyUI semantic tokens";
      matches.push({ class: m.trim(), suggestion });
    }
  }
  return matches;
}

// ── Valid tagName values ──

const VALID_TAG_NAMES = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "div",
  "Textfit",
]);

// ── Structural nodes that should never be auto-fixed ──

const STRUCTURAL_NODE_IDS = new Set([
  "ROOT",
  "page_home",
  "hdr_root",
  "hdr_section",
  "hdr_inner",
  "ftr_root",
  "ftr_content",
  "ftr_inner",
]);

/**
 * Validate and auto-fix a flat CraftJS node map.
 *
 * @param {Record<string, any>} flatMap - The flat node map to validate (MUTATED in-place for fixes)
 * @param {object} [opts] - Options
 * @param {boolean} [opts.autoFix=true] - Apply auto-fixes (src→content, tagName defaults, text wrapping)
 * @param {boolean} [opts.warnColors=true] - Warn about hardcoded colors
 * @returns {{ warnings: string[], fixes: string[], errors: string[] }}
 */
function validateNodes(flatMap, opts = {}) {
  const { autoFix = true, warnColors = true } = opts;
  const warnings = [];
  const fixes = [];
  const errors = [];

  if (!flatMap || typeof flatMap !== "object") {
    errors.push("Node map is empty or invalid.");
    return { warnings, fixes, errors };
  }

  const nodeIds = Object.keys(flatMap);

  for (const nodeId of nodeIds) {
    const node = flatMap[nodeId];
    if (!node || typeof node !== "object") continue;

    const resolvedName = node.type?.resolvedName;
    const props = node.props || {};
    const isStructural = STRUCTURAL_NODE_IDS.has(nodeId);

    // ─── Image: content → src migration (canonical prop is now "src") ───
    if (resolvedName === "Image") {
      if (props.content && !props.src) {
        if (autoFix) {
          props.src = props.content;
          delete props.content;
          // Set type to 'url' for external URLs
          if (
            !props.type &&
            typeof props.src === "string" &&
            props.src.startsWith("http")
          ) {
            props.type = "url";
          }
          fixes.push(
            `🔧 ${nodeId}: Migrated Image prop "content" → "src" (type: "${props.type || "cdn"}")`
          );
        } else {
          errors.push(
            `❌ ${nodeId}: Image uses legacy "content" prop — must use "src" (+ type: "url" for external URLs)`
          );
        }
      }
      if (!props.src && !props.content) {
        warnings.push(`⚠️ ${nodeId}: Image has no src — will render empty`);
      }
      const imgSrc = props.src ?? props.content;
      if (
        imgSrc &&
        typeof imgSrc === "string" &&
        imgSrc.startsWith("http") &&
        !props.type
      ) {
        if (autoFix) {
          props.type = "url";
          fixes.push(`🔧 ${nodeId}: Set Image type to "url" for external URL`);
        } else {
          warnings.push(`⚠️ ${nodeId}: Image has external URL but type is not set to "url"`);
        }
      }
      if (!props.alt) {
        // Already caught by a11y audit, but flag here too
        warnings.push(`⚠️ ${nodeId}: Image missing alt text`);
      }
    }

    // ─── Text: tagName validation & text wrapping ───
    if (resolvedName === "Text") {
      if (!props.tagName) {
        if (autoFix) {
          // Infer from className clues
          const cn = props.className || "";
          if (
            /text-(?:5xl|6xl|7xl|8xl|9xl|\[.*\])/.test(cn) ||
            /font-black|font-extrabold/.test(cn)
          ) {
            props.tagName = "h1";
          } else if (/text-(?:3xl|4xl)/.test(cn)) {
            props.tagName = "h2";
          } else if (/text-(?:xl|2xl)/.test(cn) && /font-bold|font-semibold/.test(cn)) {
            props.tagName = "h3";
          } else if (
            /text-\[(?:9|10|11|12)px\]|text-xs|tracking-\[/.test(cn) ||
            /uppercase/.test(cn)
          ) {
            props.tagName = "span";
          } else {
            props.tagName = "p";
          }
          fixes.push(
            `🔧 ${nodeId}: Set missing tagName to "${props.tagName}" (inferred from className)`
          );
        } else {
          errors.push(`❌ ${nodeId}: Text missing required "tagName" prop (h1-h6, p, span, div)`);
        }
      } else if (!VALID_TAG_NAMES.has(props.tagName)) {
        warnings.push(
          `⚠️ ${nodeId}: Text has invalid tagName "${props.tagName}" — valid: ${[...VALID_TAG_NAMES].join(", ")}`
        );
      }

      // ─── Heading typography defaults ───
      // If a heading tag has no text-size class, inject sensible defaults so
      // headings never render at body size with no heading font.
      if (autoFix && props.tagName && /^h[1-6]$/.test(props.tagName)) {
        const cn = props.className || "";
        const hasTextSize = /(?:^|\s)(?:md:|lg:|sm:)?text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\[)/.test(cn);
        if (!hasTextSize) {
          const HEADING_DEFAULTS = {
            h1: "font-heading font-bold text-3xl leading-tight text-base-content md:text-4xl lg:text-5xl",
            h2: "font-heading font-semibold text-2xl leading-tight text-base-content md:text-3xl",
            h3: "font-heading font-semibold text-xl leading-tight text-base-content md:text-2xl",
            h4: "font-heading font-semibold text-lg leading-tight text-base-content",
            h5: "font-heading font-medium text-base leading-tight text-base-content",
            h6: "font-heading font-medium text-sm leading-tight text-base-content",
          };
          const defaults = HEADING_DEFAULTS[props.tagName];
          if (defaults) {
            // Prepend defaults, keep any existing classes (like m-0)
            props.className = cn ? `${defaults} ${cn}` : defaults;
            fixes.push(
              `🔧 ${nodeId}: Applied heading typography defaults for <${props.tagName}>`
            );
          }
        }
      }

      // Wrap bare text in <p> tags
      if (props.text && typeof props.text === "string") {
        const trimmed = props.text.trim();
        if (trimmed && !trimmed.startsWith("<")) {
          if (autoFix) {
            props.text = `<p>${trimmed}</p>`;
            fixes.push(`🔧 ${nodeId}: Wrapped bare text in <p> tags`);
          } else {
            warnings.push(`⚠️ ${nodeId}: Text value should be wrapped in <p> or inline HTML tags`);
          }
        }
      }
    }

    // ─── Missing custom.displayName ───
    if (!isStructural && !node.custom?.displayName) {
      if (autoFix) {
        if (!node.custom) node.custom = {};
        // Generate readable name from node ID
        node.custom.displayName = nodeId
          .replace(/_/g, " ")
          .replace(/\b\w/g, c => c.toUpperCase())
          .replace(/\b(H|P|Btn|Cta|Img|Nav|Sec|Ftr|Hdr|Grp)\b/gi, m => m.toUpperCase());
        fixes.push(`🔧 ${nodeId}: Set displayName to "${node.custom.displayName}"`);
      }
    }

    // ─── Missing canDelete / canEditName ───
    if (
      !isStructural &&
      resolvedName !== "Background" &&
      resolvedName !== "Header" &&
      resolvedName !== "Footer"
    ) {
      if (props.canDelete === undefined) {
        if (autoFix) {
          props.canDelete = true;
          // Don't log these individually — too noisy
        }
      }
      if (props.canEditName === undefined) {
        if (autoFix) {
          props.canEditName = true;
        }
      }
    }

    // ─── Missing nodes/linkedNodes arrays ───
    if (!Array.isArray(node.nodes)) {
      if (autoFix) {
        node.nodes = [];
      }
    }
    if (!node.linkedNodes || typeof node.linkedNodes !== "object") {
      if (autoFix) {
        node.linkedNodes = {};
      }
    }

    // ─── Hardcoded color warnings ───
    if (warnColors && props.className) {
      const colorIssues = detectHardcodedColors(props.className);
      for (const issue of colorIssues) {
        warnings.push(
          `🎨 ${nodeId}: Hardcoded color "${issue.class}" — consider ${issue.suggestion}`
        );
      }
    }

    // ─── Parent reference validation ───
    if (node.parent && nodeId !== "ROOT") {
      if (!flatMap[node.parent]) {
        errors.push(`❌ ${nodeId}: Parent "${node.parent}" does not exist in the node map`);
      }
    }

    // ─── Children reference validation ───
    if (Array.isArray(node.nodes)) {
      for (const childId of node.nodes) {
        if (!flatMap[childId]) {
          errors.push(`❌ ${nodeId}: Child "${childId}" referenced in nodes[] but does not exist`);
        }
      }
    }
  }

  return { warnings, fixes, errors };
}

/**
 * Format validation results into a human-readable string for tool output.
 */
function formatValidationReport(result) {
  const { warnings, fixes, errors } = result;
  if (errors.length === 0 && fixes.length === 0 && warnings.length === 0) return "";

  const lines = [];

  if (errors.length > 0) {
    lines.push(`\n❌ **${errors.length} error(s) — blocking:**`);
    for (const e of errors) lines.push(e);
  }

  if (fixes.length > 0) {
    lines.push(`\n🔧 **${fixes.length} auto-fix(es) applied:**`);
    // Show first 10, summarize rest
    const show = fixes.slice(0, 10);
    for (const f of show) lines.push(f);
    if (fixes.length > 10) {
      lines.push(`  ...and ${fixes.length - 10} more fixes`);
    }
  }

  // Cap color warnings to avoid flooding
  if (warnings.length > 0) {
    const colorWarnings = warnings.filter(w => w.startsWith("🎨"));
    const otherWarnings = warnings.filter(w => !w.startsWith("🎨"));

    if (otherWarnings.length > 0) {
      lines.push(`\n⚠️ **${otherWarnings.length} warning(s):**`);
      for (const w of otherWarnings) lines.push(w);
    }

    if (colorWarnings.length > 0) {
      lines.push(
        `\n🎨 **${colorWarnings.length} hardcoded color(s) detected** — use DaisyUI semantic tokens (bg-base-100, text-base-content, etc.) for theme compatibility:`
      );
      const showColors = colorWarnings.slice(0, 5);
      for (const w of showColors) lines.push(w);
      if (colorWarnings.length > 5) {
        lines.push(
          `  ...and ${colorWarnings.length - 5} more. Run with DaisyUI tokens for proper theme support.`
        );
      }
    }
  }

  return lines.join("\n");
}

module.exports = { validateNodes, formatValidationReport, detectHardcodedColors };
