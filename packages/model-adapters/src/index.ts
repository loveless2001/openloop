export { ModelAdapterError, type ModelErrorCode } from "./model-error.js";
export { MockModelAdapter } from "./mock-adapter.js";
export {
  OllamaModelAdapter,
  type OllamaModelAdapterConfig,
} from "./ollama-adapter.js";
export {
  OpenAICompatibleAdapter,
  type OpenAICompatibleAdapterConfig,
} from "./openai-compatible-adapter.js";
export type {
  CompletionChunk,
  CompletionInput,
  CriticInput,
  ModelAdapter,
  ReconcileInput,
} from "./types.js";
export {
  COMPLETION_PROMPT_VERSION,
  completionSystemPrompt,
} from "./prompts/completion.v1.js";
export {
  CRITIC_PROMPT_VERSION,
  criticSystemPrompt,
} from "./prompts/critic.v1.js";
