/** Shared AI model configuration — used by both server and client. */

const AI_MODELS = [
  { value: "alibaba/qwen3-coder-30b-a3b", label: "Auto" },
  { value: "xai/grok-code-fast-1", label: "Fast" },
];

const DEFAULT_MODEL = "alibaba/qwen3-coder-30b-a3b";

const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));

module.exports = { AI_MODELS, DEFAULT_MODEL, ALLOWED_MODEL_VALUES };
