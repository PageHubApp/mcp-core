/** Shared AI model configuration — used by both server and client. */

const AI_MODELS = [
  { value: "xai/grok-code-fast-1", label: "Auto" },
];

const DEFAULT_MODEL = "xai/grok-code-fast-1";

const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));

module.exports = { AI_MODELS, DEFAULT_MODEL, ALLOWED_MODEL_VALUES };
