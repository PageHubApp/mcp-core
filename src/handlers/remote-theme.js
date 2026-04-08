const { apiFetch } = require('../api-fetch');
const { getContext } = require('../context');
const {
  stripGoogleFontLinksFromHeader,
  finalizeRootThemeFonts,
} = require('../../../../scripts/lib/theme-fonts.js');
const {
  parseMaybeJson,
  getActiveTarget,
  fetchTarget,
  saveTarget,
} = require('../helpers');
const { ensurePaletteOklch } = require('../color-utils');
const { resultMsg } = require('./remote-shared');

module.exports = {
  async suggest_palettes(args) {
    // The model generates palette options as structured data in the args
    // We just pass them through for the frontend to render as clickable swatches
    const options = parseMaybeJson(args.options) || [];
    return {
      content: [{ type: 'text', text: `Generated ${options.length} palette options.` }],
      paletteOptions: options,
    };
  },

  async upload_image(args) {
    const target = getActiveTarget(args);
    if (target.type === 'template') {
      throw new Error('upload_image is not supported for templates. Use hardcoded image URLs (type: "url") instead.');
    }
    const siteId = target.id;
    if (!args.imageUrl && !args.dataBase64) {
      throw new Error('Provide imageUrl or dataBase64.');
    }
    const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (args.mimeType && !ALLOWED_MIME.includes(args.mimeType)) {
      throw new Error(`Unsupported mimeType "${args.mimeType}". Allowed: ${ALLOWED_MIME.join(', ')}`);
    }
    const body = {
      ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
      ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
      ...(args.mimeType ? { mimeType: args.mimeType } : {}),
      ...(args.filename ? { filename: args.filename } : {}),
    };
    const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/media`, {
      method: 'POST',
      body,
    });
    return {
      content: [{
        type: 'text',
        text: `Uploaded.\n  mediaId: ${data.mediaId}\n  type: cdn\n  url: ${data.url}\n\nUse in nodes: { "type": "cdn", "content": "${data.mediaId}" }.`,
      }],
    };
  },

  async set_theme(args) {
    const { preset, palette, darkPalette, styleGuide, fonts, jsonLd, buildStyle: explicitBuildStyle } = args;
    const target = getActiveTarget(args);
    const ctx = getContext();

    const { flat } = await fetchTarget(args);
    if (!flat?.ROOT) throw new Error('Site/template has no ROOT node.');
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
      if (!presetRecord) throw new Error(`Preset "${preset}" not found. Use list_presets to see available presets.`);
      if (!resolvedPalette) resolvedPalette = presetRecord.palette;
      if (!resolvedDarkPalette && presetRecord.darkPalette) resolvedDarkPalette = presetRecord.darkPalette;
      if (!resolvedStyleGuide) resolvedStyleGuide = presetRecord.styleGuide;
      if (!resolvedFonts) resolvedFonts = presetRecord.fonts;
    }

    // Propagate buildStyle to context for downstream search_blocks auto-filtering
    if (explicitBuildStyle) {
      ctx.buildStyle = explicitBuildStyle;
    } else if (presetRecord?.style) {
      ctx.buildStyle = presetRecord.style;
    }
    if (ctx.buildStyle) {
      rootProps.buildStyle = ctx.buildStyle;
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
        const byName = (n) => pal.find((p) => String(p.name || '').toLowerCase() === n);
        const fromPal = byName('accent') || byName('primary');
        if (fromPal?.color) {
          merged.linkColor = fromPal.color;
          if (presetSg.linkHoverColor == null) {
            merged.linkHoverColor = fromPal.color;
          }
        }
      }
    }

    finalizeRootThemeFonts(rootProps, resolvedFonts);

    const headerClean = stripGoogleFontLinksFromHeader(rootProps.header || '');
    let ld = '';
    const resolvedJsonLd = parseMaybeJson(jsonLd);
    if (resolvedJsonLd) {
      ld = `<script type="application/ld+json">${JSON.stringify(resolvedJsonLd)}</script>`;
    }
    const nextHeader = [headerClean, ld].filter(Boolean).join('');
    if (nextHeader) rootProps.header = nextHeader;
    else delete rootProps.header;

    const changedNodes = { ROOT: flat.ROOT };
    const presetMsg = preset ? ` (preset: ${preset})` : '';

    // Draft mode: store in pending flat map for aiDraft save
    if (ctx.draftMode) {
      ctx._pendingFlatMap = flat;
      return {
        content: [{ type: 'text', text: `Theme updated${presetMsg}.` }],
        pendingContent: flat,
        changedNodes,
      };
    }

    const result = await saveTarget(target.id, target.type, flat);
    return {
      content: [{ type: 'text', text: resultMsg(result.id, target.type, `Theme updated${presetMsg}.`) }],
      changedNodes,
    };
  },
};
