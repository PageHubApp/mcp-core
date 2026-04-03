/** Shared AI model configuration — used by both server and client. */

const AI_MODELS = [
  { value: "openai/gpt-5.4-nano", label: "Auto" },
];

const DEFAULT_MODEL = "openai/gpt-5.4-nano";

const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));

module.exports = { AI_MODELS, DEFAULT_MODEL, ALLOWED_MODEL_VALUES };
