/** Shared AI model configuration — used by both server and client. */

const AI_MODELS = [
  { value: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku" },
  { value: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "google/gemini-3.1-flash", label: "Gemini Flash" },
];

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5-20251001";

const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));

module.exports = { AI_MODELS, DEFAULT_MODEL, ALLOWED_MODEL_VALUES };
