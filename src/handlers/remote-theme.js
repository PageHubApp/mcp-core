const { apiFetch } = require("../core/api-fetch");
const { getContext, withPendingMapLock } = require("../core/context");
const { stripGoogleFontLinksFromHeader, finalizeRootThemeFonts } = require("../lib/theme-fonts.js");
const { parseMaybeJson, getActiveTarget, fetchTarget, saveTarget } = require("../helpers/index.js");
const { ensurePaletteOklch, validatePaletteContrast } = require("../utils/color-utils");
const { resultMsg } = require("./remote-shared");
const { stampPresetDesignIntent } = require("../data/root-design-intent");
const { VIBE_CODENAMES } = require("../data/vibes");

// ── Build-style validation ───────────────────────────────────────────────────
// `buildStyle` on ROOT.props must be one of the 6 canonical vibes
// (packages/mcp-core/src/vibes.js) or `search_blocks` will filter against a
// codename the block index doesn't know. We try the live `/api/v1/components/styles`
// distinct() first so vibe additions made in vibes.js but not yet synced to Mongo
// still narrow to what's actually in the library; fall back to the vibes.js list
// if the fetch fails.
let _validStylesCache = null;
let _validStylesFetchedAt = 0;
const VALID_STYLES_TTL_MS = 5 * 60 * 1000;

async function getValidBuildStyles() {
  const now = Date.now();
  if (_validStylesCache && now - _validStylesFetchedAt < VALID_STYLES_TTL_MS) {
    return _validStylesCache;
  }
  try {
    const data = await apiFetch(`/api/v1/components/styles`);
    const list = Array.isArray(data?.styles) ? data.styles : null;
    if (list && list.length) {
      _validStylesCache = new Set(list.map(String));
      _validStylesFetchedAt = now;
      return _validStylesCache;
    }
  } catch {
    /* fall through to seed fallback */
  }
  _validStylesCache = new Set(VIBE_CODENAMES);
  _validStylesFetchedAt = now;
  return _validStylesCache;
}

const { editDistance } = require("../utils/levenshtein");

function suggestStyle(invalid, validSet) {
  const lower = String(invalid).toLowerCase();
  let best = null;
  let bestScore = Infinity;
  for (const v of validSet) {
    const d = editDistance(lower, String(v).toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = v;
    }
  }
  return bestScore <= Math.max(2, Math.floor(lower.length / 2)) ? best : null;
}

function designPickerOptionsResult(kind, args) {
  const options = parseMaybeJson(args.options) || [];
  return {
    content: [{ type: "text", text: `Generated ${options.length} ${kind}.` }],
    paletteOptions: options,
  };
}

/**
 * Append contrast warnings (Primary ≈ Base Content / Base 100) to a
 * suggest_palettes result so the AI sees the issue in its tool output and can
 * re-roll with shifted lightness/hue. Pure additive — the editor still receives
 * `paletteOptions` unchanged, so the user can still pick a flagged palette
 * if they want; the warning is for the agent, not a hard block.
 */
function annotatePaletteWarnings(result, options) {
  const warnLines = [];
  for (const opt of options) {
    if (!opt || !Array.isArray(opt.palette)) continue;
    const issues = validatePaletteContrast(opt.palette);
    if (issues.length) {
      const label = opt.name || "(unnamed)";
      warnLines.push(`  • "${label}":`);
      for (const w of issues) warnLines.push(`      - ${w}`);
    }
  }
  if (warnLines.length) {
    const head = result.content?.[0];
    head.text += `\n\nContrast warnings:\n${warnLines.join("\n")}`;
  }
  return result;
}

module.exports = {
  async suggest_palettes(args) {
    const options = parseMaybeJson(args.options) || [];
    const result = designPickerOptionsResult("palette options", args);
    return annotatePaletteWarnings(result, options);
  },

  /** Font-only design picker — same client pipeline as suggest_palettes (`paletteOptions`). */
  async suggest_font_pairings(args) {
    return designPickerOptionsResult("font pairing options", args);
  },

  async upload_image(args) {
    const target = getActiveTarget(args);
    if (target.type === "template") {
      throw new Error(
        'upload_image is not supported for templates. Use hardcoded image URLs (type: "url") instead.'
      );
    }
    const siteId = target.id;
    if (!args.imageUrl && !args.dataBase64) {
      throw new Error("Provide imageUrl or dataBase64.");
    }
    const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
    if (args.mimeType && !ALLOWED_MIME.includes(args.mimeType)) {
      throw new Error(
        `Unsupported mimeType "${args.mimeType}". Allowed: ${ALLOWED_MIME.join(", ")}`
      );
    }
    const body = {
      ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
      ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
      ...(args.mimeType ? { mimeType: args.mimeType } : {}),
      ...(args.filename ? { filename: args.filename } : {}),
    };
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/media`, {
      method: "POST",
      body,
    });
    return {
      content: [
        {
          type: "text",
          text: `Uploaded.\n  mediaId: ${data.mediaId}\n  type: cdn\n  url: ${data.url}\n\nUse in nodes: { "type": "cdn", "content": "${data.mediaId}" }.`,
        },
      ],
    };
  },

  async set_theme(args) {
    return withPendingMapLock(() => setThemeBody(args));
  },
};

async function setThemeBody(args) {
  const {
    preset,
    palette,
    darkPalette,
    styleGuide,
    fonts,
    jsonLd,
    buildStyle: explicitBuildStyle,
  } = args;
  const target = getActiveTarget(args);
  const ctx = getContext();

  const { flat } = await fetchTarget(args);
  if (!flat?.ROOT) throw new Error("Site/template has no ROOT node.");
  const rootProps = flat.ROOT.props;

  // Resolve preset values (explicit args override preset)
  let resolvedPalette = parseMaybeJson(palette);
  let resolvedDarkPalette = parseMaybeJson(darkPalette);
  let resolvedStyleGuide = parseMaybeJson(styleGuide);
  let resolvedFonts = parseMaybeJson(fonts);
  let presetRecord = null;
  if (preset) {
    const presetData = await apiFetch(`/api/v1/presets/${encodeURIComponent(preset)}`);
    presetRecord = presetData.preset;
    if (!presetRecord) {
      // Common cock-up: agent passed a block-library style codename
      // (bakehouse, archival, ...) instead of a preset slug. Differentiate
      // and tell it where each vocabulary belongs so the next call lands.
      let suggestion = "";
      try {
        const validStyles = await getValidBuildStyles();
        if (validStyles.has(String(preset))) {
          suggestion = ` "${preset}" is a block-library STYLE codename, not a preset slug — those vocabularies are different. Style codenames belong on \`search_blocks({ style: "..." })\`. For set_theme, pass a preset slug like "warm-editorial", "modern-minimal", "luxury-dark", "restaurant-warm", "medical", "corporate-blue", etc.`;
        }
      } catch {
        /* ignore */
      }
      throw new Error(
        `Preset "${preset}" not found.${suggestion} Use list_presets to see all available preset slugs.`
      );
    }
    if (!resolvedPalette) resolvedPalette = presetRecord.palette;
    if (!resolvedDarkPalette && presetRecord.darkPalette)
      resolvedDarkPalette = presetRecord.darkPalette;
    if (!resolvedStyleGuide) resolvedStyleGuide = presetRecord.styleGuide;
    if (!resolvedFonts) resolvedFonts = presetRecord.fonts;
  }

  // Propagate buildStyle to context for downstream search_blocks auto-filtering.
  // Validate against the live block library — stamping an unknown codename
  // (e.g. legacy "warm" / "minimal" from old presets) makes the +Blocks
  // panel filter chip match nothing for the user.
  const validStyles = await getValidBuildStyles();
  const styleWarnings = [];
  let candidateBuildStyle = null;
  if (explicitBuildStyle) {
    candidateBuildStyle = String(explicitBuildStyle);
  } else if (presetRecord?.style) {
    candidateBuildStyle = String(presetRecord.style);
  }
  if (candidateBuildStyle) {
    if (validStyles.has(candidateBuildStyle)) {
      ctx.buildStyle = candidateBuildStyle;
      rootProps.buildStyle = candidateBuildStyle;
    } else {
      const suggestion = suggestStyle(candidateBuildStyle, validStyles);
      const source = explicitBuildStyle ? "explicit buildStyle arg" : `preset "${preset}" .style`;
      styleWarnings.push(
        `buildStyle "${candidateBuildStyle}" from ${source} is not a valid block-library style and was NOT stamped.${
          suggestion ? ` Closest match: "${suggestion}".` : ""
        } Pass an explicit buildStyle from: ${[...validStyles].sort().join(", ")}.`
      );
      // Clear any stale buildStyle on the site so block search isn't filtered by garbage
      if (rootProps.buildStyle && !validStyles.has(rootProps.buildStyle)) {
        delete rootProps.buildStyle;
        ctx.buildStyle = null;
      }
    }
  }

  if (presetRecord) {
    stampPresetDesignIntent(rootProps, presetRecord);
  }

  // Read existing theme
  const existingTheme = rootProps.theme || {};
  const existingPalette = existingTheme.palette || [];
  const existingDarkPalette = existingTheme.darkPalette;
  const existingStyleGuide = existingTheme.styleGuide || {};

  // Build unified theme object
  if (!rootProps.theme) rootProps.theme = {};

  // Apply palette
  if (resolvedPalette) rootProps.theme.palette = ensurePaletteOklch(resolvedPalette);
  else if (existingPalette.length) rootProps.theme.palette = existingPalette;

  // Apply dark palette
  if (resolvedDarkPalette) {
    rootProps.theme.darkPalette = ensurePaletteOklch(resolvedDarkPalette);
    rootProps.theme.darkModeEnabled = true;
  } else if (existingDarkPalette) {
    rootProps.theme.darkPalette = existingDarkPalette;
  }

  // Merge styleGuide
  if (resolvedStyleGuide) {
    rootProps.theme.styleGuide = { ...existingStyleGuide, ...resolvedStyleGuide };
  } else if (Object.keys(existingStyleGuide).length) {
    rootProps.theme.styleGuide = existingStyleGuide;
  }

  // Presets often omit link tokens; merged styleGuide would keep starter blues. Tie links to palette.
  const themePalette = rootProps.theme.palette || [];
  if (preset && presetRecord?.styleGuide && themePalette.length) {
    const presetSg = presetRecord.styleGuide;
    const merged = rootProps.theme.styleGuide;
    if (presetSg.linkColor == null) {
      const pal = themePalette;
      const byName = n => pal.find(p => String(p.name || "").toLowerCase() === n);
      const fromPal = byName("accent") || byName("primary");
      if (fromPal?.color) {
        merged.linkColor = fromPal.color;
        if (presetSg.linkHoverColor == null) {
          merged.linkHoverColor = fromPal.color;
        }
      }
    }
  }

  finalizeRootThemeFonts(rootProps, resolvedFonts);

  if (!rootProps.inject) rootProps.inject = {};
  const headerClean = stripGoogleFontLinksFromHeader(rootProps.inject.head || "");
  let ld = "";
  const resolvedJsonLd = parseMaybeJson(jsonLd);
  if (resolvedJsonLd) {
    ld = `<script type="application/ld+json">${JSON.stringify(resolvedJsonLd)}</script>`;
    if (!rootProps.seo) rootProps.seo = {};
    rootProps.seo.jsonLd = resolvedJsonLd;
  }
  const nextHeader = [headerClean, ld].filter(Boolean).join("");
  if (nextHeader) rootProps.inject.head = nextHeader;
  else delete rootProps.inject.head;
  if (Object.keys(rootProps.inject).length === 0) delete rootProps.inject;

  const changedNodes = { ROOT: flat.ROOT };
  const presetMsg = preset ? ` (preset: ${preset})` : "";
  const warnSuffix = styleWarnings.length
    ? `\n\nbuildStyle warnings:\n${styleWarnings.map(w => `  - ${w}`).join("\n")}`
    : "";

  // Draft mode: store in pending flat map for aiDraft save
  if (ctx.draftMode) {
    ctx._pendingFlatMap = flat;
    return {
      content: [{ type: "text", text: `Theme updated${presetMsg}.${warnSuffix}` }],
      pendingContent: flat,
      changedNodes,
    };
  }

  const result = await saveTarget(target.id, target.type, flat);
  return {
    content: [
      {
        type: "text",
        text: resultMsg(result.id, target.type, `Theme updated${presetMsg}.${warnSuffix}`),
      },
    ],
    changedNodes,
  };
}
