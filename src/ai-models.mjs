/** Shared AI model configuration — used by both server and client. */

/**
 * lockStyling = true means the fill agent may NOT mutate className /
 * classNamePatch. Blocks ship pre-styled; weaker/cheaper models (Qwen, etc.)
 * consistently strip accent backgrounds, hardcode text sizes, and mix
 * component classes wrong — so for those models we only allow copy / images /
 * icons / semantic props. Premium models (Claude, etc.) get free styling.
 */
export const AI_MODELS = [
  { value: "alibaba/qwen3-coder-30b-a3b", label: "Auto", lockStyling: true },
];

export const DEFAULT_MODEL = "alibaba/qwen3-coder-30b-a3b";

/**
 * Candidates accepted by the agent endpoint but never offered in the picker,
 * and never outside development.
 *
 * The shipped model cannot use prompt caching at all, which is why a chat turn
 * re-pays for its whole ~30k-token preamble on every step. These are the
 * cache-capable alternatives being measured against it. They are deliberately
 * NOT in `AI_MODELS` — that list drives the UI — so a user can never land on an
 * unevaluated model, and the production guard means a forgotten cleanup cannot
 * ship one either.
 */
const EVAL_MODEL_VALUES =
  process.env.NODE_ENV === "production"
    ? []
    : [
        "alibaba/qwen3.8-flash",
        "alibaba/qwen3.8-flash-next",
        "alibaba/qwen3.7-flash",
        // The cheapest premium model whose margin survives a flailing session
        // (+29% even at the shipped model's 7.2M-token / no-cache volume).
        "anthropic/claude-haiku-4.5",
      ];

export const ALLOWED_MODEL_VALUES = new Set([
  ...AI_MODELS.map(m => m.value),
  ...EVAL_MODEL_VALUES,
]);

/** Returns the model's `lockStyling` flag (true when className patches must be stripped). */
export function modelLocksStyling(modelValue) {
  if (!modelValue) return true; // fail closed — assume cheap model
  const entry = AI_MODELS.find(m => m.value === modelValue);
  return entry ? entry.lockStyling !== false : true;
}
