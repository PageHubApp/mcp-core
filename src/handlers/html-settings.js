/**
 * `set_theme` / `set_favicon` on an HTML-first site: the theme is `theme.css` and the favicon is `site.json`
 * `favicon`, so both are written by the server (`PUT /api/v1/sites/:id/source-settings`), with the same generators
 * that wrote the file when the site was converted (app repo: docs/features/html-first-ai-mcp.md, "Theme").
 * handlers/remote-theme.js and handlers/site-config.js try the node-tree path first and come here when the site
 * answers `SITE_IS_HTML`.
 *
 * The server sets custom properties one by one and leaves every other line of theme.css alone, so a partial call
 * (only `palette`, only `fonts`) changes only that.
 */
const { apiFetch } = require("../core/api-fetch");
const { getContext } = require("../core/context");
const { getActiveTarget, getEditorUrl } = require("../helpers/target");
const { parseMaybeJson } = require("../helpers/index.js");
const { ensurePaletteOklch, validateContentColors } = require("../utils/color-utils");
const { familyNamesFromGoogleFontsUrl } = require("../lib/theme-fonts.js");

const text = t => ({ content: [{ type: "text", text: t }] });

const WEIGHTS = {
  "font-thin": "100",
  "font-extralight": "200",
  "font-light": "300",
  "font-normal": "400",
  "font-medium": "500",
  "font-semibold": "600",
  "font-bold": "700",
  "font-extrabold": "800",
  "font-black": "900",
};

/** Not applicable on an HTML-first site, and what to do instead. */
const REFUSED = {
  animations: "Site animations are CSS: add the @keyframes and the class to theme.css with edit_site_file.",
  removeAnimations: "Site animations are CSS: remove the @keyframes from theme.css with edit_site_file.",
  jsonLd: "JSON-LD is markup: put the <script type=\"application/ld+json\"> in the page file (or site.json inject for every page) with edit_site_file.",
};

async function put(siteId, body) {
  try {
    const res = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/source-settings`, { method: "PUT", body });
    getContext()._sourceFilesWritten = true;
    return res;
  } catch (err) {
    const b = err?.body || {};
    if (b.error === "maintenance") {
      throw new Error(`PageHub is in maintenance, so edits are paused: ${b.message || "try again later"}. Nothing was saved; tell the user and stop.`);
    }
    if (b.error === "lint") {
      const issues = (b.issues || []).slice(0, 5).map(i => `  - [${i.rule}] ${i.message}`).join("\n");
      throw new Error(`${b.path || "The file"} was NOT saved:\n${issues}`);
    }
    if (b.message) throw new Error(b.message);
    throw err;
  }
}

/** Typography tokens from the fonts argument and any legacy scalar keys on the styleGuide (which are consumed). */
function typographyFrom(fonts, styleGuide) {
  let names = [];
  if (fonts?.families?.length) names = fonts.families.map(f => String(f).split(":")[0].trim().replace(/\+/g, " "));
  else if (fonts?.url) names = familyNamesFromGoogleFontsUrl(fonts.url);
  const patch = { Heading: {}, Body: {} };
  // Preset convention: fonts[0] is the body, fonts[1] the heading; one font does both.
  if (names.length === 1) patch.Heading.fontFamily = patch.Body.fontFamily = names[0];
  else if (names.length >= 2) {
    patch.Body.fontFamily = names[0];
    patch.Heading.fontFamily = names[1];
  }
  if (styleGuide) {
    if (styleGuide.headingFontFamily) patch.Heading.fontFamily = styleGuide.headingFontFamily;
    if (styleGuide.bodyFontFamily) patch.Body.fontFamily = styleGuide.bodyFontFamily;
    if (styleGuide.headingFont) patch.Heading.fontWeight = WEIGHTS[styleGuide.headingFont] || String(styleGuide.headingFont);
    if (styleGuide.bodyFont) patch.Body.fontWeight = WEIGHTS[styleGuide.bodyFont] || String(styleGuide.bodyFont);
    for (const k of ["headingFontFamily", "bodyFontFamily", "headingFont", "bodyFont"]) delete styleGuide[k];
  }
  return Object.entries(patch)
    .filter(([, fields]) => Object.keys(fields).length)
    .map(([name, fields]) => ({ name, ...fields }));
}

async function presetFor(slug) {
  const data = await apiFetch(`/api/v1/presets/${encodeURIComponent(slug)}`);
  if (!data.preset) throw new Error(`Preset "${slug}" not found. Use list_presets to see all available preset slugs.`);
  return data.preset;
}

module.exports = {
  async setTheme(args) {
    const siteId = getActiveTarget(args).id;
    const refused = Object.keys(REFUSED).filter(k => args[k] !== undefined && args[k] !== null);
    if (refused.length) throw new Error(`${refused.map(k => `${k}: ${REFUSED[k]}`).join("\n")}\nNothing was changed.`);

    let palette = parseMaybeJson(args.palette);
    let darkPalette = parseMaybeJson(args.darkPalette);
    let styleGuide = parseMaybeJson(args.styleGuide);
    let fonts = parseMaybeJson(args.fonts);
    let preset = null;
    if (args.preset) {
      preset = await presetFor(args.preset);
      palette = palette || preset.palette;
      darkPalette = darkPalette || preset.darkPalette;
      styleGuide = styleGuide || preset.styleGuide;
      fonts = fonts || preset.fonts;
    }
    styleGuide = styleGuide ? { ...styleGuide } : undefined;

    // A preset that sets no link colours ties them to the palette, as on a node-tree site.
    if (preset && palette?.length && preset.styleGuide && preset.styleGuide.linkColor == null) {
      const byName = n => palette.find(p => String(p.name || "").toLowerCase() === n);
      const link = (byName("accent") || byName("primary"))?.color;
      if (link) styleGuide = { ...styleGuide, linkColor: link, ...(preset.styleGuide.linkHoverColor == null ? { linkHoverColor: link } : {}) };
    }

    const typography = typographyFrom(fonts, styleGuide);
    const theme = {
      ...(palette ? { palette: ensurePaletteOklch(palette) } : {}),
      ...(darkPalette ? { darkPalette: ensurePaletteOklch(darkPalette), darkModeEnabled: true } : {}),
      ...(styleGuide && Object.keys(styleGuide).length ? { styleGuide } : {}),
      ...(typography.length ? { typography } : {}),
      ...(typeof args.daisyui === "boolean" ? { daisyui: args.daisyui } : {}),
    };
    if (!Object.keys(theme).length) {
      throw new Error("Nothing to change: pass a preset, palette, darkPalette, styleGuide, fonts or daisyui.");
    }

    const res = await put(siteId, { theme });
    const warnings = [...validateContentColors(theme.palette || []), ...validateContentColors(theme.darkPalette || []).map(w => `dark: ${w}`)];
    const names = (res.theme?.set || []).join(", ");
    return text(
      `Theme updated${preset ? ` (preset: ${args.preset})` : ""} in theme.css: ${names || "no change"}.\nSaved to the draft; publish_site makes it live.\nEditor: ${getEditorUrl(siteId)}` +
        (warnings.length ? `\n\nText color warnings:\n${warnings.map(w => `  - ${w}`).join("\n")}` : "")
    );
  },

  async setFavicon(args) {
    const target = getActiveTarget(args);
    if (target.type === "template") throw new Error("set_favicon is not supported for templates — favicons are per-site only.");
    if (args.filePath) {
      throw new Error("filePath is only available in the local PageHub MCP server (stdio). In the hosted agent, pass imageUrl, mediaId, or dataBase64 instead.");
    }
    const siteId = target.id;
    if (args.clear) {
      await put(siteId, { favicon: null });
      return text(`Favicon cleared.\nEditor: ${getEditorUrl(siteId)}`);
    }
    const provided = ["mediaId", "imageUrl", "dataBase64", "svgContent"].filter(k => args[k]);
    if (provided.length === 0) {
      throw new Error("A favicon source is required. Provide one of: filePath (local file — easiest), mediaId, imageUrl, dataBase64, svgContent — or `clear: true`. Do NOT invent SVG markup.");
    }
    if (provided.length > 1) throw new Error(`Provide only one source; got: ${provided.join(", ")}.`);

    let favicon;
    let summary;
    if (args.svgContent) {
      const svg = String(args.svgContent).trim();
      if (!svg.startsWith("<svg") && !svg.startsWith("<?xml")) throw new Error("svgContent must be raw SVG markup starting with <svg or <?xml.");
      favicon = { content: svg, type: "image/svg+xml" };
      summary = "inline SVG";
    } else if (args.mediaId) {
      favicon = { href: String(args.mediaId), type: "cdn" };
      summary = `mediaId ${args.mediaId}`;
    } else {
      const data = await apiFetch(`/api/v1/sites/${encodeURIComponent(siteId)}/media`, {
        method: "POST",
        body: {
          ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
          ...(args.dataBase64 ? { dataBase64: args.dataBase64 } : {}),
          ...(args.mimeType ? { mimeType: args.mimeType } : {}),
          filename: args.filename || "favicon",
        },
      });
      favicon = { href: data.mediaId, type: "cdn" };
      summary = `uploaded mediaId ${data.mediaId} (${data.url})`;
    }
    await put(siteId, { favicon });
    return text(`Favicon set in site.json: ${summary}.\nEditor: ${getEditorUrl(siteId)}`);
  },
};
