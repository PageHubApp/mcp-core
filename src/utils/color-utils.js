// ── OKLch conversion ────────────────────────────────────────────────────────
// Converts sRGB to OKLch color space for perceptually uniform palette storage.
// Matrix coefficients are from the OKLab spec (Björn Ottosson, 2020):
// https://bottosson.github.io/posts/oklab/

/** Linearize an sRGB channel (inverse sRGB companding). */
function _lin(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert linear RGB [0–1] to OKLch [L, C, H]. */
function _toOklch(r, g, b) {
  const lr = _lin(r),
    lg = _lin(g),
    lb = _lin(b);
  // sRGB → LMS (M1 matrix from OKLab spec)
  const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l1 = Math.cbrt(l_),
    m1 = Math.cbrt(m_),
    s1 = Math.cbrt(s_);
  const L = 0.2104542553 * l1 + 0.793617785 * m1 - 0.0040720468 * s1;
  const a = 1.9779984951 * l1 - 2.428592205 * m1 + 0.4505937099 * s1;
  const bk = 0.0259040371 * l1 + 0.7827717662 * m1 - 0.808675766 * s1;
  const C = Math.sqrt(a * a + bk * bk),
    H = (Math.atan2(bk, a) * 180) / Math.PI;
  return [L, C, H < 0 ? H + 360 : H];
}
function colorToOklch(color) {
  if (!color || color.startsWith("oklch(")) return color;
  let r, g, b;
  const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgba) {
    r = +rgba[1] / 255;
    g = +rgba[2] / 255;
    b = +rgba[3] / 255;
  } else if (color.match(/^hsla?\(/)) {
    return color;
  } // pass through hsl
  else {
    let h = color.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
  }
  if (isNaN(r)) return color;
  const [L, C, H] = _toOklch(r, g, b);
  const lP = +(L * 100).toFixed(3),
    cV = +C.toFixed(4),
    hV = +H.toFixed(3);
  return cV < 0.0001 ? `oklch(${lP}% 0 0)` : `oklch(${lP}% ${cV} ${hV})`;
}
function ensurePaletteOklch(palette) {
  if (!Array.isArray(palette)) return palette;
  return palette.map(p => ({ ...p, color: colorToOklch(p.color) }));
}

/** Parse `oklch(L% C H)` → L as 0..1, or null if not parseable. */
function oklchLightness(color) {
  if (typeof color !== "string") return null;
  const m = color.match(/oklch\(\s*([\d.]+)%/i);
  return m ? parseFloat(m[1]) / 100 : null;
}

/**
 * Validate a palette for the lightness collisions that produce "invisible" UI:
 *   • Primary ≈ Base Content → `text-primary` icons / accents disappear into body text
 *     (e.g. kit-block accent icons all read as plain dark glyphs).
 *   • Primary ≈ Base 100      → `btn-primary` fill blends with the page background.
 *
 * Returns an array of human-readable warning strings (empty when palette is fine).
 * Caller is expected to surface these so the AI can self-correct.
 *
 * MIN_DELTA_L = 0.15 matches the CLAUDE.md "if Primary ≈ Base 100 … invisible" rule
 * and gives roughly the perceptual gap needed for monochrome icons to read as accents.
 */
function validatePaletteContrast(palette, { minDeltaL = 0.15 } = {}) {
  if (!Array.isArray(palette)) return [];
  const byName = Object.fromEntries(palette.map(p => [p.name, p.color]));
  const warnings = [];
  const primary = oklchLightness(byName["Primary"]);
  const baseContent = oklchLightness(byName["Base Content"]);
  const base100 = oklchLightness(byName["Base 100"]);
  if (primary != null && baseContent != null) {
    const d = Math.abs(primary - baseContent);
    if (d < minDeltaL) {
      warnings.push(
        `Primary ≈ Base Content (ΔL=${d.toFixed(2)} < ${minDeltaL}). ` +
          `Icons / accents using "text-primary" will look identical to body text. ` +
          `Shift Primary's lightness or hue so it reads as a distinct accent.`
      );
    }
  }
  if (primary != null && base100 != null) {
    const d = Math.abs(primary - base100);
    if (d < minDeltaL) {
      warnings.push(
        `Primary ≈ Base 100 (ΔL=${d.toFixed(2)} < ${minDeltaL}). ` +
          `"btn-primary" fills will blend into the page background.`
      );
    }
  }
  return warnings;
}

/** `oklch(L% C H)` → WCAG relative luminance, or null if not parseable. */
function oklchLuminance(color) {
  const m = typeof color === "string" && color.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i);
  if (!m) return null;
  let L = parseFloat(m[1]);
  if (L > 1) L /= 100;
  const h = (parseFloat(m[3]) * Math.PI) / 180;
  const a = parseFloat(m[2]) * Math.cos(h);
  const b = parseFloat(m[2]) * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = v => Math.max(0, Math.min(1, v));
  const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

const CONTENT_PAIRS = {
  Primary: "Primary Content",
  Secondary: "Secondary Content",
  Accent: "Accent Content",
  Neutral: "Neutral Content",
  "Base 100": "Base Content",
  Error: "Error Content",
  Info: "Info Content",
  Success: "Success Content",
  Warning: "Warning Content",
};

/**
 * The renderer keeps an author's `* Content` color only when it clears WCAG AA
 * (4.5:1) against its surface, and silently swaps in a derived color otherwise
 * (SDK `autoGenerateContentColors`). Say so up front, so the agent learns its
 * brand text color won't ship instead of discovering it in a screenshot.
 * Expects an oklch palette (run `ensurePaletteOklch` first).
 */
function validateContentColors(palette) {
  if (!Array.isArray(palette)) return [];
  const byName = Object.fromEntries(palette.map(p => [p.name, p.color]));
  const warnings = [];
  for (const [surface, content] of Object.entries(CONTENT_PAIRS)) {
    const sl = oklchLuminance(byName[surface]);
    const cl = oklchLuminance(byName[content]);
    if (sl == null || cl == null) continue;
    const ratio = (Math.max(sl, cl) + 0.05) / (Math.min(sl, cl) + 0.05);
    if (ratio < 4.5) {
      warnings.push(
        `"${content}" on "${surface}" is ${ratio.toFixed(2)}:1, below WCAG AA 4.5:1 — ` +
          `the renderer will REPLACE it with an auto-generated readable color. ` +
          `Pick a darker/lighter "${content}" if you need that exact color to ship.`
      );
    }
  }
  return warnings;
}

module.exports = {
  colorToOklch,
  ensurePaletteOklch,
  oklchLightness,
  validatePaletteContrast,
  validateContentColors,
};
