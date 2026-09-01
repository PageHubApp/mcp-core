const { apiFetch } = require("../core/api-fetch");
const { getContext, withPendingMapLock } = require("../core/context");

const { stampPresetDesignIntent } = require("../data/root-design-intent");
const { VIBE_CODENAMES } = require("../data/vibes");

const { parseMaybeJson, getActiveTarget, fetchTarget, saveTarget } = require("../helpers/index.js");
const { formatUploadResult } = require("../helpers/upload-format");

const { ensurePaletteOklch, validatePaletteContrast } = require("../utils/color-utils");
const { editDistance } = require("../utils/levenshtein");

const { resultMsg } = require("./remote-shared");

const { stripGoogleFontLinksFromHeader, finalizeRootThemeFonts } = require("../lib/theme-fonts.js");

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

const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/**
 * Shared upload path for `upload_image` (image-only) and `upload_file` (any
 * plan-allowed type). POSTs to `/api/v1/sites/:id/media`, which routes images
 * to Cloudflare Images (`type: "cdn"`) and everything else to R2 (`type: "r2"`).
 * @param {object} args - { fileUrl?|imageUrl?, dataBase64?, mimeType?, filename?, id?/site_id? }
 * @param {{restrictToImages: boolean}} opts
 * @returns {Promise<{mediaId:string, type:string, url:string, contentType?:string}>}
 */
async function uploadMediaToSite(args, { restrictToImages }) {
  const target = getActiveTarget(args);
  if (target.type === "template") {
    throw new Error(
      `${
        restrictToImages ? "upload_image" : "upload_file"
      } is not supported for templates. Use hardcoded URLs (type: "url") instead.`
    );
  }
  // `filePath` reads the caller's own disk, so it only exists in the local
  // stdio MCP server. Here — the hosted agent — "the disk" is PageHub's
  // server, which the caller has no business reading from.
  if (args.filePath) {
    throw new Error(
      "filePath is only available in the local PageHub MCP server (stdio). " +
        "In the hosted agent, pass fileUrl (a public http(s) URL) or dataBase64 instead."
    );
  }
  const srcUrl = args.fileUrl || args.imageUrl;
  if (!srcUrl && !args.dataBase64) {
    throw new Error("fileUrl or dataBase64 is required.");
  }
  if (restrictToImages && args.mimeType && !ALLOWED_IMAGE_MIME.includes(args.mimeType)) {
    throw new Error(
      `Unsupported mimeType "${args.mimeType}". Allowed: ${ALLOWED_IMAGE_MIME.join(", ")}.`
    );
  }
  // A bare base64 blob (no data-URL prefix) carries no type — the server would
  // default it to image/jpeg. Require mimeType so non-image uploads route to R2.
  if (!restrictToImages && args.dataBase64 && !args.mimeType) {
    const hasDataUrlMime = /^data:[\w.+-]+\/[\w.+-]+;base64,/.test(String(args.dataBase64));
    if (!hasDataUrlMime) {
      throw new Error(
        "mimeType is required with dataBase64 for non-image uploads (e.g. video/mp4, application/pdf)."
      );
    }
  }
  const body = {
    ...(srcUrl ? { fileUrl: srcUrl } : {}),
    ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
    ...(args.mimeType ? { mimeType: args.mimeType } : {}),
    ...(args.filename ? { filename: args.filename } : {}),
  };
  return apiFetch(`/api/v1/sites/${encodeURIComponent(target.id)}/media`, {
    method: "POST",
    body,
  });
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
    const data = await uploadMediaToSite(args, { restrictToImages: true });
    return { content: [{ type: "text", text: formatUploadResult(data) }] };
  },

  async upload_file(args) {
    const data = await uploadMediaToSite(args, { restrictToImages: false });
    return { content: [{ type: "text", text: formatUploadResult(data) }] };
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
