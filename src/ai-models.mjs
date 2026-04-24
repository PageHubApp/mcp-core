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

export const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));

/** Returns the model's `lockStyling` flag (true when className patches must be stripped). */
export function modelLocksStyling(modelValue) {
  if (!modelValue) return true; // fail closed — assume cheap model
  const entry = AI_MODELS.find(m => m.value === modelValue);
  return entry ? entry.lockStyling !== false : true;
}
