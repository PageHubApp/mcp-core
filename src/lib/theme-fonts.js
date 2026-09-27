/**
 * Theme fonts: styleGuide + Background `className` utilities — not Google `<link>` in ROOT.props.inject.head.
 * Used by MCP `set_theme` and `scripts/TemplateBuilder.js` `setTheme`.
 */

function stripGoogleFontLinksFromHeader(header) {
  if (!header || typeof header !== "string") return "";
  return header
    .replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi, "")
    .replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/gi, "")
    .trim();
}

function familyNamesFromGoogleFontsUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string" || !urlStr.includes("fonts.googleapis.com")) return [];
  let qs = urlStr;
  const qIdx = urlStr.indexOf("?");
  if (qIdx >= 0) qs = urlStr.slice(qIdx + 1);
  const out = [];
  for (const part of qs.split("&")) {
    if (!part.startsWith("family=")) continue;
    let v = part.slice("family=".length);
    try {
      v = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      v = v.replace(/\+/g, " ");
    }
    const colon = v.indexOf(":");
    const name = (colon === -1 ? v : v.slice(0, colon)).trim();
    if (name) out.push(name);
  }
  return out;
}

function finalizeRootThemeFonts(rootProps, resolvedFonts) {
  if (!rootProps.theme) rootProps.theme = {};
  if (!Array.isArray(rootProps.theme.typography)) rootProps.theme.typography = [];
  const typography = rootProps.theme.typography;

  // Heading/Body live in theme.typography[] now. Patch family/weight by name; create with
  // sensible defaults if missing.
  const upsertToken = (name, fields) => {
    const idx = typography.findIndex(t => t && t.name === name);
    if (idx >= 0) {
      typography[idx] = { ...typography[idx], ...fields };
      return;
    }
    typography.push({
      name,
      fontFamily: fields.fontFamily || "Open Sans",
      fontSize: name === "Heading" ? "1.5rem" : "1rem",
      fontWeight: fields.fontWeight || (name === "Heading" ? "700" : "400"),
      lineHeight: name === "Heading" ? "1.2" : "1.5",
      letterSpacing: "normal",
      textTransform: "none",
    });
  };

  let names = [];
  if (resolvedFonts?.families?.length) {
    names = resolvedFonts.families.map(f => String(f).split(":")[0].trim().replace(/\+/g, " "));
  } else if (resolvedFonts?.url) {
    names = familyNamesFromGoogleFontsUrl(resolvedFonts.url);
  }
  // Preset fonts feed Heading[1] / Body[0] (preset convention) — same priority as before.
  if (names.length === 1) {
    upsertToken("Heading", { fontFamily: names[0] });
    upsertToken("Body", { fontFamily: names[0] });
  } else if (names.length >= 2) {
    upsertToken("Body", { fontFamily: names[0] });
    upsertToken("Heading", { fontFamily: names[1] });
  }

  // Forward-compat shim: AI agents / templates may still pass legacy
  // styleGuide.headingFontFamily / bodyFontFamily / headingFont / bodyFont scalars.
  // Move them into typography[] tokens and delete from styleGuide.
  const sg = rootProps.theme.styleGuide;
  if (sg && typeof sg === "object") {
    const weightMap = {
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
    const headingPatch = {};
    const bodyPatch = {};
    if (sg.headingFontFamily) headingPatch.fontFamily = sg.headingFontFamily;
    if (sg.bodyFontFamily) bodyPatch.fontFamily = sg.bodyFontFamily;
    if (sg.headingFont) headingPatch.fontWeight = weightMap[sg.headingFont] || sg.headingFont;
    if (sg.bodyFont) bodyPatch.fontWeight = weightMap[sg.bodyFont] || sg.bodyFont;
    if (Object.keys(headingPatch).length) upsertToken("Heading", headingPatch);
    if (Object.keys(bodyPatch).length) upsertToken("Body", bodyPatch);
    delete sg.headingFontFamily;
    delete sg.bodyFontFamily;
    delete sg.headingFont;
    delete sg.bodyFont;
  }
}

module.exports = {
  stripGoogleFontLinksFromHeader,
  familyNamesFromGoogleFontsUrl,
  finalizeRootThemeFonts,
};
