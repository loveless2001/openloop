export { ModelAdapterError, type ModelErrorCode } from "./model-error.js";
export { MockModelAdapter } from "./mock-adapter.js";
export {
  OLLAMA_CAUSAL_PROMPT_VERSION,
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
  CriticContextProvider,
  CriticContextRequest,
  CriticContextResponse,
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
export {
  RECONCILE_PROMPT_VERSION,
  reconcileSystemPrompt,
} from "./prompts/reconcile.v1.js";
