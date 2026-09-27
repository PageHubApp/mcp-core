/**
 * Single source of truth for block-library vibes.
 *
 * A "vibe" is the aesthetic family a template (and its extracted blocks) belongs to.
 * Templates declare one vibe via their top-level `style` field; blocks carry a
 * `styles: [vibe, ...]` array derived from the templates that use them. The site's
 * current vibe lives on `ROOT.props.buildStyle` and is auto-injected as a hard
 * filter in `search_blocks` / `list_blocks` so generated sites stay visually cohesive.
 *
 * Consumed by:
 *   - `handlers/remote-theme.js` — validates `buildStyle` args against VIBE_CODENAMES
 *   - `index.js` — resolves the `"$VIBES"` sentinel in `tools.json` enums
 *   - `/api/v1/components/styles` (app side) — live distinct() from Mongo, should
 *     always return a subset of VIBE_CODENAMES once blocks are synced
 *
 * Adding / removing a vibe: update this file, re-run the template→vibe migration
 * so blocks get re-derived, and `pnpm run sync:mongo`.
 */

const VIBES = [
  {
    codename: "aurora",
    label: "Aurora",
    description: "Dark bg, gradient orbs, glassmorphism, glow",
  },
  {
    codename: "brutalist",
    label: "Brutalist",
    description: "Hard edges, heavy type, B&W + accent",
  },
  {
    codename: "corporate",
    label: "Corporate",
    description: "Clean, photo-heavy, professional, trustworthy",
  },
  {
    codename: "editorial",
    label: "Editorial",
    description: "Serif, paper/warm, content-first, archive feel",
  },
  {
    codename: "minimal",
    label: "Minimal",
    description: "Spacious, type-led, restrained, mostly light",
  },
  {
    codename: "organic",
    label: "Organic",
    description: "Warm palette, soft shapes, approachable, handmade",
  },
];

const VIBE_CODENAMES = VIBES.map(v => v.codename);

module.exports = { VIBES, VIBE_CODENAMES };
