import type { CompletionInput } from "../types.js";

export const OLLAMA_CAUSAL_PROMPT_VERSION = "causal-prefix.v1";

export function buildCausalCompletionPrefix(input: CompletionInput): string {
  return input.prefix.slice(-1_500);
}
