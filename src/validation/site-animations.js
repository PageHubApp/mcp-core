/**
 * Site animations (`ROOT.props.theme.animations`) and `root.animation` keys.
 *
 * JS port of the SDK's `validateSiteAnimation`
 * (packages/sdk/src/utils/animations/siteAnimations.ts). The SDK sanitizer
 * still runs at CSS emit time and is the security boundary; this module exists
 * so a bad write comes back as a specific error instead of an animation that
 * silently never renders.
 *
 * The built-in preset list and the property allowlist are copies of the SDK's
 * data files, written into ../data/sdk by `pnpm gen:animation-presets` and
 * drift-checked by `pnpm verify:animation-presets`. They ship inside this
 * package, so the npm build (which has no @pagehub/sdk) reads them too.
 */
const ANIMATION_PRESETS = require("../data/sdk/animation-presets.json");
const SITE_ANIMATION_PROPERTIES = require("../data/sdk/site-animation-properties.json");

const SITE_ANIMATION_PREFIX = "site:";
const SITE_ANIMATION_LIMIT = 50;
const SITE_ANIMATION_KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;
const TRIGGERS = ["scroll", "load", "continuous"];
const DIRECTIONS = ["normal", "reverse", "alternate", "alternate-reverse"];
// Mirrors packages/sdk/src/utils/animations/siteAnimations.ts — keep in step.
/** Keys of `EASING_MAP` in packages/sdk/src/utils/animations/animations.ts. */
const EASING_KEYS = ["easeOut", "easeIn", "easeInOut", "linear", "spring"];
const EASING_KEYWORDS = [
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
];
const NUM = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`;
const CUBIC_BEZIER_RE = new RegExp(String.raw`^cubic-bezier\(\s*${NUM}(?:\s*,\s*${NUM}){3}\s*\)$`);
const STEPS_RE =
  /^steps\(\s*\d{1,3}\s*(?:,\s*(?:jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/;
const FORBIDDEN_VALUE_PATTERNS = [
  "<",
  ">",
  "{",
  "}",
  ";",
  "\\",
  "@",
  "/*",
  "url(",
  "expression(",
  "image(",
  "image-set(",
];
const MAX_VALUE_LENGTH = 200;
const MAX_LABEL_LENGTH = 60;

const isValidEasing = e =>
  typeof e === "string" &&
  (EASING_KEYS.includes(e) ||
    EASING_KEYWORDS.includes(e) ||
    CUBIC_BEZIER_RE.test(e) ||
    STEPS_RE.test(e));

/**
 * Framer-motion keys still rendered by the React path — the `animations` map in
 * packages/sdk/src/utils/tailwind/tailwind.ts. Accepted on write so existing
 * nodes stay editable, but they do not render on the static document (what
 * /view and static-publish domains serve), so every write is warned toward the
 * matching css* preset.
 */
const LEGACY_FRAMER_ANIMATIONS = new Set([
  "tween",
  "spring",
  "hoverGrow",
  "abounce",
  "bounce",
  "fadeIn",
  "fadeUp",
  "fadeDown",
  "fadeLeft",
  "fadeRight",
  "scaleUp",
  "blurIn",
  "slideUp",
  "flipIn",
  "hoverLift",
  "hoverGlow",
  "press",
]);

/** @returns {string[]} CSS properties a site animation keyframe may set. */
function getAllowedProperties() {
  return SITE_ANIMATION_PROPERTIES;
}

/** @returns {{ key: string, label: string, group: string, trigger: string }[]} */
function getBuiltinPresets() {
  return ANIMATION_PRESETS;
}

function getBuiltinKeys() {
  return getBuiltinPresets().map(p => p.key);
}

const isSiteAnimationKey = v =>
  typeof v === "string" &&
  v.startsWith(SITE_ANIMATION_PREFIX) &&
  v.length > SITE_ANIMATION_PREFIX.length;

/** Theme animation slugs defined on a flat map's ROOT. */
function getSiteAnimationKeys(flat) {
  const list = flat?.ROOT?.props?.theme?.animations;
  if (!Array.isArray(list)) return [];
  return list.map(a => a?.key).filter(k => typeof k === "string");
}

function forbiddenFragment(value) {
  const lower = value.toLowerCase();
  return FORBIDDEN_VALUE_PATTERNS.find(p => lower.includes(p)) || null;
}

/**
 * Validate one site animation and return it normalized (numeric strings →
 * numbers, numeric keyframe values → strings) so the stored shape matches the
 * SDK's `SiteAnimation` type.
 *
 * @returns {{ errors: string[], value: object | null }}
 */
function validateSiteAnimation(input, index = 0) {
  const where = `animations[${index}]`;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      errors: [
        `${where}: must be an object { key, label, trigger, duration, easing, iterations, keyframes }.`,
      ],
      value: null,
    };
  }
  const errors = [];
  const key = input.key;
  const at = typeof key === "string" && key ? `${where} ("${key}")` : where;

  if (typeof key !== "string" || !SITE_ANIMATION_KEY_RE.test(key)) {
    errors.push(
      `${at}: key ${JSON.stringify(key)} is invalid — use a lowercase slug matching ${SITE_ANIMATION_KEY_RE} (e.g. "line-draw"). Don't include the "site:" prefix; nodes reference it as "site:<key>".`
    );
  }
  if (
    typeof input.label !== "string" ||
    !input.label.trim() ||
    input.label.length > MAX_LABEL_LENGTH
  ) {
    errors.push(
      `${at}: label must be a non-empty string up to ${MAX_LABEL_LENGTH} characters (shown in the editor's animation picker).`
    );
  }
  if (!TRIGGERS.includes(input.trigger)) {
    errors.push(
      `${at}: trigger ${JSON.stringify(input.trigger)} is invalid — use "scroll" (plays when scrolled into view), "load" (plays once on page load) or "continuous" (loops from load; pair with iterations "infinite").`
    );
  }

  const duration = typeof input.duration === "string" ? Number(input.duration) : input.duration;
  if (
    typeof duration !== "number" ||
    !Number.isFinite(duration) ||
    duration < 0.05 ||
    duration > 30
  ) {
    errors.push(
      `${at}: duration ${JSON.stringify(input.duration)} must be a number of seconds between 0.05 and 30.`
    );
  }

  const easing = typeof input.easing === "string" ? input.easing.trim() : input.easing;
  if (!isValidEasing(easing)) {
    errors.push(
      `${at}: easing ${JSON.stringify(input.easing)} is invalid — use one of ${EASING_KEYS.join(", ")}, a CSS keyword (${EASING_KEYWORDS.join(", ")}), "cubic-bezier(x1, y1, x2, y2)" or "steps(n)".`
    );
  }

  let iterations = input.iterations;
  if (typeof iterations === "string" && iterations !== "infinite" && /^\d+$/.test(iterations)) {
    iterations = Number(iterations);
  }
  if (!(
    iterations === "infinite" ||
    (Number.isInteger(iterations) && iterations >= 1 && iterations <= 20)
  )) {
    errors.push(
      `${at}: iterations ${JSON.stringify(input.iterations)} must be a whole number 1–20 or "infinite".`
    );
  }

  if (input.direction != null && !DIRECTIONS.includes(input.direction)) {
    errors.push(
      `${at}: direction ${JSON.stringify(input.direction)} is invalid — use ${DIRECTIONS.join(", ")} (or omit for "normal").`
    );
  }

  const keyframes = [];
  if (
    !Array.isArray(input.keyframes) ||
    input.keyframes.length < 2 ||
    input.keyframes.length > 12
  ) {
    errors.push(
      `${at}: keyframes must be an array of 2–12 stops, each { at: 0–100, style: { property: value } }, including at 0 and at 100.`
    );
  } else {
    let allowed;
    try {
      allowed = new Set(getAllowedProperties());
    } catch (err) {
      errors.push(`${at}: ${err.message}`);
    }
    const seen = new Set();
    input.keyframes.forEach((frame, i) => {
      const fw = `${at}.keyframes[${i}]`;
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
        errors.push(`${fw}: must be { at, style }.`);
        return;
      }
      const pct = typeof frame.at === "string" ? Number(frame.at.replace(/%$/, "")) : frame.at;
      if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        errors.push(
          `${fw}: at ${JSON.stringify(frame.at)} must be a number 0–100 (percent of the animation).`
        );
      } else if (seen.has(pct)) {
        errors.push(`${fw}: duplicate stop at ${pct} — merge its properties into the other stop.`);
      } else {
        seen.add(pct);
      }
      const style = frame.style;
      if (
        !style ||
        typeof style !== "object" ||
        Array.isArray(style) ||
        Object.keys(style).length === 0
      ) {
        errors.push(
          `${fw}: style must be a non-empty object of CSS property → value (kebab-case, e.g. { "clip-path": "inset(0 100% 0 0)" }).`
        );
        return;
      }
      const outStyle = {};
      for (const [prop, raw] of Object.entries(style)) {
        if (allowed && !allowed.has(prop)) {
          errors.push(
            `${fw}: property "${prop}" is not allowed. Allowed: ${[...allowed].join(", ")}. Layout properties (width, height, top, margin…) are excluded — use transform: scaleX() or clip-path: inset() instead.`
          );
          continue;
        }
        const value = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
        if (typeof value !== "string" || !value.trim() || value.length > MAX_VALUE_LENGTH) {
          errors.push(
            `${fw}: "${prop}" value must be a non-empty string up to ${MAX_VALUE_LENGTH} characters.`
          );
          continue;
        }
        const bad = forbiddenFragment(value);
        if (bad) {
          errors.push(
            `${fw}: "${prop}" value ${JSON.stringify(value)} contains "${bad}", which is not allowed in keyframe values (no ${FORBIDDEN_VALUE_PATTERNS.join(" ")}). Palette vars like var(--primary) are fine.`
          );
          continue;
        }
        outStyle[prop] = value.trim();
      }
      keyframes.push({ at: pct, style: outStyle });
    });
    if (seen.size && (!seen.has(0) || !seen.has(100))) {
      errors.push(
        `${at}: keyframes must include a stop at 0 and a stop at 100 (have: ${[...seen].sort((a, b) => a - b).join(", ")}).`
      );
    }
  }

  if (errors.length) return { errors, value: null };
  const value = {
    key,
    label: input.label.trim(),
    trigger: input.trigger,
    duration,
    easing,
    iterations,
    keyframes: keyframes.sort((a, b) => a.at - b.at),
  };
  if (input.direction != null) value.direction = input.direction;
  return { errors: [], value };
}

/**
 * Upsert `incoming` (by key) and drop `remove` keys from `existing`.
 * Throws one error listing every problem so the caller can fix them in a
 * single retry.
 *
 * @returns {{ animations: object[], upserted: string[], removed: string[] }}
 */
function mergeSiteAnimations(existing, incoming, remove) {
  const list = Array.isArray(existing) ? existing.filter(a => a && typeof a.key === "string") : [];
  const errors = [];
  const removeKeys = [];
  if (remove != null) {
    if (!Array.isArray(remove)) errors.push("removeAnimations must be an array of keys.");
    else {
      for (const raw of remove) {
        const k =
          typeof raw === "string" && raw.startsWith(SITE_ANIMATION_PREFIX)
            ? raw.slice(SITE_ANIMATION_PREFIX.length)
            : raw;
        if (!list.some(a => a.key === k)) {
          errors.push(
            `removeAnimations: "${raw}" is not defined on this site (defined: ${list.map(a => a.key).join(", ") || "none"}).`
          );
        } else removeKeys.push(k);
      }
    }
  }
  const valid = [];
  if (incoming != null) {
    if (!Array.isArray(incoming))
      errors.push("animations must be an array of site animation objects.");
    else {
      const seenKeys = new Set();
      incoming.forEach((a, i) => {
        const { errors: e, value } = validateSiteAnimation(a, i);
        errors.push(...e);
        if (!value) return;
        if (seenKeys.has(value.key))
          errors.push(`animations[${i}]: key "${value.key}" appears twice in this call.`);
        seenKeys.add(value.key);
        valid.push(value);
      });
    }
  }
  if (errors.length) {
    throw new Error(
      `set_theme animations rejected — nothing was written:\n- ${errors.join("\n- ")}\n\nShape and examples: get_style_reference({ topic: "animation" }).`
    );
  }
  const next = list.filter(a => !removeKeys.includes(a.key));
  for (const a of valid) {
    const idx = next.findIndex(x => x.key === a.key);
    if (idx === -1) next.push(a);
    else next[idx] = a;
  }
  if (next.length > SITE_ANIMATION_LIMIT) {
    throw new Error(
      `set_theme animations rejected: a site can define at most ${SITE_ANIMATION_LIMIT} animations (this call would leave ${next.length}). Remove unused ones with removeAnimations.`
    );
  }
  return { animations: next, upserted: valid.map(a => a.key), removed: removeKeys };
}

/**
 * Check a `root.animation` value against the built-ins and the target tree's
 * theme animations.
 *
 * @param {unknown} value
 * @param {Record<string, any>} flat — the target's flat map (ROOT holds the theme)
 * @param {string} nodeId
 * @returns {{ error?: string, warning?: string }}
 */
function checkNodeAnimation(value, flat, nodeId) {
  if (value == null || value === "") return {};
  const siteKeys = getSiteAnimationKeys(flat);
  const builtins = getBuiltinKeys();
  const siteList = siteKeys.length ? siteKeys.map(k => `site:${k}`).join(", ") : "none defined";
  const reject = reason => ({
    error:
      `root.animation on "${nodeId}": ${reason}\n` +
      `Built-in presets: ${builtins.join(", ")}.\n` +
      `This site's animations: ${siteList}.\n` +
      `For a motion no preset covers, define it once with set_theme({ animations: [{ key, label, trigger, duration, easing, iterations, keyframes }] }) and reference it as "site:<key>" — see get_style_reference({ topic: "animation" }).`,
  });
  if (typeof value !== "string")
    return reject(`must be a string key, got ${JSON.stringify(value)}.`);
  if (isSiteAnimationKey(value)) {
    const slug = value.slice(SITE_ANIMATION_PREFIX.length);
    if (siteKeys.includes(slug)) return {};
    return reject(`"${value}" is not defined in this site's theme.animations.`);
  }
  if (builtins.includes(value)) return {};
  if (LEGACY_FRAMER_ANIMATIONS.has(value))
    return { warning: legacyAnimationMessage(value, nodeId) };
  return reject(`"${value}" is not a built-in preset or a site animation.`);
}

/**
 * Warning for a legacy framer key, else null. Needs no tree, so the
 * prop-support table can report it on every touched node.
 */
function legacyAnimationMessage(value, nodeId) {
  if (typeof value !== "string" || !LEGACY_FRAMER_ANIMATIONS.has(value)) return null;
  const guess = `css${value[0].toUpperCase()}${value.slice(1)}`;
  let suggestion = "cssFadeIn";
  try {
    if (getBuiltinKeys().includes(guess)) suggestion = guess;
  } catch {
    /* registry missing — keep the generic suggestion */
  }
  return (
    `root.animation "${value}"${nodeId ? ` on "${nodeId}"` : ""} is a legacy framer key: it plays only in the React viewer, not on the static document that /view and published static sites serve. ` +
    `Use a css* preset (e.g. "${suggestion}") or a site:<key> animation.`
  );
}

/** Throw on an invalid `root.animation`; returns a warning string or null. */
function assertNodeAnimation(value, flat, nodeId) {
  const { error, warning } = checkNodeAnimation(value, flat, nodeId);
  if (error) throw new Error(error);
  return warning || null;
}

/**
 * `assertNodeAnimation` over every node of a submitted map (add_nodes /
 * insert_node), checked against the live target tree's theme.
 *
 * @returns {string[]} legacy-key warnings
 */
function assertNodeMapAnimations(nodes, flat) {
  const warnings = [];
  for (const [id, node] of Object.entries(nodes || {})) {
    let props = node?.props;
    if (typeof props === "string") {
      try {
        props = JSON.parse(props);
      } catch {
        continue;
      }
    }
    const root = props?.root;
    if (root && typeof root === "object" && "animation" in root) {
      const warning = assertNodeAnimation(root.animation, flat, id);
      if (warning) warnings.push(warning);
    }
  }
  return warnings;
}

module.exports = {
  SITE_ANIMATION_PREFIX,
  SITE_ANIMATION_LIMIT,
  LEGACY_FRAMER_ANIMATIONS,
  getAllowedProperties,
  getBuiltinPresets,
  getSiteAnimationKeys,
  isSiteAnimationKey,
  validateSiteAnimation,
  mergeSiteAnimations,
  checkNodeAnimation,
  assertNodeAnimation,
  assertNodeMapAnimations,
  legacyAnimationMessage,
};
