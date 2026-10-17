/** Shared AI model configuration — used by both server and client. */

/**
 * Picker sections, in display order.
 */
export const AI_MODEL_GROUPS = [
  { key: "fast", label: "Fast" },
  { key: "standard", label: "Standard" },
  { key: "best", label: "Best" },
];

/**
 * lockStyling = true means the fill agent may NOT mutate className /
 * classNamePatch. Blocks ship pre-styled; weaker/cheaper models (Qwen, etc.)
 * consistently strip accent backgrounds, hardcode text sizes, and mix
 * component classes wrong — so for those models we only allow copy / images /
 * icons / semantic props. Claude models get free styling. Models that haven't
 * been seen working with the agent start locked.
 *
 * vendor: picks the logo in the picker.
 * group: picker section (AI_MODEL_GROUPS key).
 * pageCredits: rough credits for one full landing-page build, from a
 *   reference turn (~700k input tokens at ~80% cache reads, ~30k output) at
 *   list price × 1.4 markup. A guide only — re-measure from AiLog rawCost.
 * minPlan: lowest plan that may use the model; omitted = every plan.
 * packUnlocks: buying any credit pack also unlocks the model below minPlan.
 * forcedToolChoice: false when the model 400s on toolChoice "required" / a named tool.
 * temperature: false when the model 400s on temperature / top_p.
 */
export const AI_MODELS = [
  {
    value: "anthropic/claude-haiku-4.5",
    label: "Haiku 4.5",
    vendor: "anthropic",
    group: "fast",
    pageCredits: 490,
    lockStyling: false,
  },
  {
    value: "google/gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    vendor: "google",
    group: "fast",
    pageCredits: 360,
    lockStyling: true,
  },
  {
    value: "anthropic/claude-sonnet-5.5",
    label: "Sonnet 5.5",
    vendor: "anthropic",
    group: "standard",
    pageCredits: 890,
    lockStyling: false,
    forcedToolChoice: false,
    temperature: false,
  },
  {
    value: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    vendor: "openai",
    group: "standard",
    pageCredits: 1050,
    lockStyling: true,
  },
  {
    value: "anthropic/claude-opus-5.5",
    label: "Opus 5.5",
    vendor: "anthropic",
    group: "best",
    minPlan: "pro",
    packUnlocks: true,
    pageCredits: 1780,
    lockStyling: false,
    forcedToolChoice: false,
    temperature: false,
  },
  {
    value: "anthropic/claude-fable-5.1",
    label: "Fable 5.1",
    vendor: "anthropic",
    group: "best",
    minPlan: "business",
    pageCredits: 4260,
    lockStyling: false,
    forcedToolChoice: false,
    temperature: false,
  },
];

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

/**
 * Candidates accepted by the agent endpoint but never offered in the picker,
 * and never outside development. Deliberately NOT in `AI_MODELS` — that list
 * drives the UI — so a user can never land on an unevaluated model, and the
 * production guard means a forgotten cleanup cannot ship one either.
 */
const EVAL_MODEL_VALUES =
  process.env.NODE_ENV === "production"
    ? []
    : ["alibaba/qwen3.8-flash", "alibaba/qwen3.8-flash-next", "alibaba/qwen3.7-flash"];

export const ALLOWED_MODEL_VALUES = new Set([...AI_MODELS.map(m => m.value), ...EVAL_MODEL_VALUES]);

const PLAN_RANK = { free: 0, pro: 1, business: 2, agency: 3 };

function findModel(modelValue) {
  return AI_MODELS.find(m => m.value === modelValue);
}

/** Returns the model's `lockStyling` flag (true when className patches must be stripped). */
export function modelLocksStyling(modelValue) {
  if (!modelValue) return true; // fail closed — assume cheap model
  const entry = findModel(modelValue);
  return entry ? entry.lockStyling !== false : true;
}

/** False for models that 400 on forced tool_choice ("required" / a named tool). */
export function modelAllowsForcedToolChoice(modelValue) {
  return findModel(modelValue)?.forcedToolChoice !== false;
}

/** False for models that 400 on temperature / top_p. */
export function modelAllowsTemperature(modelValue) {
  return findModel(modelValue)?.temperature !== false;
}

/**
 * True when this user may use the model. Eval models (dev only) carry no plan
 * gate; any other value outside AI_MODELS is never allowed.
 */
export function modelAllowedForPlan(modelValue, plan, hasBoughtCredits = false) {
  const entry = findModel(modelValue);
  if (!entry) return EVAL_MODEL_VALUES.includes(modelValue);
  if (!entry.minPlan) return true;
  if ((PLAN_RANK[plan] ?? 0) >= PLAN_RANK[entry.minPlan]) return true;
  return !!entry.packUnlocks && hasBoughtCredits;
}
