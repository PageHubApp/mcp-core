/** Shared AI model configuration — used by both server and client. */

const AI_MODELS = [
  { value: "anthropic/claude-3-haiku", label: "Auto" },
];

const DEFAULT_MODEL = "openai/gpt-4o-mini";

const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));

module.exports = { AI_MODELS, DEFAULT_MODEL, ALLOWED_MODEL_VALUES };
