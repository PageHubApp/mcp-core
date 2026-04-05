/** Shared AI model configuration — used by both server and client. */

export const AI_MODELS = [{ value: "alibaba/qwen3-coder-30b-a3b", label: "Auto" }];

export const DEFAULT_MODEL = "alibaba/qwen3-coder-30b-a3b";

export const ALLOWED_MODEL_VALUES = new Set(AI_MODELS.map(m => m.value));
