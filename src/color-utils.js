// ── OKLch conversion ────────────────────────────────────────────────────────
// Converts sRGB to OKLch color space for perceptually uniform palette storage.
// Matrix coefficients are from the OKLab spec (Björn Ottosson, 2020):
// https://bottosson.github.io/posts/oklab/

/** Linearize an sRGB channel (inverse sRGB companding). */
function _lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

/** Convert linear RGB [0–1] to OKLch [L, C, H]. */
function _toOklch(r, g, b) {
  const lr = _lin(r), lg = _lin(g), lb = _lin(b);
  // sRGB → LMS (M1 matrix from OKLab spec)
  const l_ = .4122214708*lr + .5363325363*lg + .0514459929*lb;
  const m_ = .2119034982*lr + .6806995451*lg + .1073969566*lb;
  const s_ = .0883024619*lr + .2220049494*lg + .6396926187*lb;
  const l1 = Math.cbrt(l_), m1 = Math.cbrt(m_), s1 = Math.cbrt(s_);
  const L = .2104542553*l1 + .7936177850*m1 - .0040720468*s1;
  const a = 1.9779984951*l1 - 2.4285922050*m1 + .4505937099*s1;
  const bk = .0259040371*l1 + .7827717662*m1 - .8086757660*s1;
  const C = Math.sqrt(a*a + bk*bk), H = Math.atan2(bk, a) * 180 / Math.PI;
  return [L, C, H < 0 ? H + 360 : H];
}
function colorToOklch(color) {
  if (!color || color.startsWith('oklch(')) return color;
  let r, g, b;
  const rgba = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgba) { r = +rgba[1]/255; g = +rgba[2]/255; b = +rgba[3]/255; }
  else if (color.match(/^hsla?\(/)) { return color; } // pass through hsl
  else { let h = color.replace('#',''); if (h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; r=parseInt(h.slice(0,2),16)/255; g=parseInt(h.slice(2,4),16)/255; b=parseInt(h.slice(4,6),16)/255; }
  if (isNaN(r)) return color;
  const [L, C, H] = _toOklch(r, g, b);
  const lP = +(L*100).toFixed(3), cV = +C.toFixed(4), hV = +H.toFixed(3);
  return cV < .0001 ? `oklch(${lP}% 0 0)` : `oklch(${lP}% ${cV} ${hV})`;
}
function ensurePaletteOklch(palette) {
  if (!Array.isArray(palette)) return palette;
  return palette.map(p => ({ ...p, color: colorToOklch(p.color) }));
}

module.exports = { colorToOklch, ensurePaletteOklch };
