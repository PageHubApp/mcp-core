/** Shared AI model configuration — used by both server and client. */

const AI_MODELS = [
  { value: "alibaba/qwen3-coder", label: "Auto" },
  { value: "xai/grok-code-fast-1", label: "Grok Code Fast" },
];

const DEFAULT_MODEL = "alibaba/qwen3-coder";

const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));

module.exports = { AI_MODELS, DEFAULT_MODEL, ALLOWED_MODEL_VALUES };
