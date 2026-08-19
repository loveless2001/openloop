import {
  MockModelAdapter,
  OllamaModelAdapter,
  OpenAICompatibleAdapter,
  type ModelAdapter,
} from "@openloop/model-adapters";

import type { Environment } from "../config/env.js";
import { OllamaRuntime } from "./ollama-runtime.js";

export interface SelectedModel {
  adapter: ModelAdapter;
  model: string;
  runtime: { state: "ready" | "warming" | "unavailable" };
  warmup?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

export interface SelectedModelAdapters {
  completion: SelectedModel;
  critic: SelectedModel;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function selectModel(input: {
  provider: Environment["COMPLETION_PROVIDER"];
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsJsonSchema: boolean;
  role: "completion" | "critic";
  keepAlive: string;
}): SelectedModel {
  if (input.provider === "mock") {
    return {
      adapter: new MockModelAdapter(),
      model: input.role === "completion" ? "mock-fast-v1" : "mock-smart-v1",
      runtime: { state: "ready" },
    };
  }

  const isOpenAI = input.provider === "openai";

  const usesNativeOllama =
    input.provider === "ollama" && input.role === "completion";
  const runtime: SelectedModel["runtime"] = {
    state: usesNativeOllama ? "warming" : "ready",
  };
  let warmupPromise: Promise<void> | undefined;
  const ollamaRuntime = usesNativeOllama
    ? new OllamaRuntime({ baseUrl: input.baseUrl, model: input.model })
    : undefined;
  const adapter = usesNativeOllama
    ? new OllamaModelAdapter({
        baseUrl: input.baseUrl,
        model: input.model,
        keepAlive: input.keepAlive,
        contextTokens: 2_048,
      })
    : new OpenAICompatibleAdapter({
        baseUrl: isOpenAI ? OPENAI_BASE_URL : input.baseUrl,
        apiKey: input.apiKey,
        fastModel: input.model,
        smartModel: input.model,
        supportsJsonSchema: isOpenAI ? true : input.supportsJsonSchema,
        providerId: input.provider,
        openAIRequestParameters: isOpenAI,
      });
  const selected: SelectedModel = {
    adapter,
    model: input.model,
    runtime,
  };
  if (usesNativeOllama) {
    selected.shutdown = () => ollamaRuntime!.shutdown();
    selected.warmup = () => {
      if (warmupPromise) return warmupPromise;
      runtime.state = "warming";
      warmupPromise = ollamaRuntime!
        .ensureReady()
        .then(() => (adapter as OllamaModelAdapter).warmup())
        .then(() => {
          runtime.state = "ready";
        })
        .catch((error: unknown) => {
          runtime.state = "unavailable";
          warmupPromise = undefined;
          throw error;
        });
      return warmupPromise;
    };
  }
  return selected;
}

export function selectModelAdapters(
  environment: Environment,
  options?: { criticOverride?: SelectedModel },
): SelectedModelAdapters {
  if (environment.CRITIC_PROVIDER === "cli-agent" && !options?.criticOverride) {
    throw new Error("The cli-agent provider requires a server-owned adapter.");
  }
  return {
    completion: selectModel({
      provider: environment.COMPLETION_PROVIDER,
      baseUrl: environment.COMPLETION_BASE_URL,
      apiKey: environment.COMPLETION_API_KEY,
      model: environment.COMPLETION_MODEL,
      supportsJsonSchema: false,
      role: "completion",
      keepAlive: environment.COMPLETION_KEEP_ALIVE,
    }),
    critic:
      options?.criticOverride ??
      selectModel({
        provider:
          environment.CRITIC_PROVIDER === "cli-agent"
            ? "mock"
            : environment.CRITIC_PROVIDER,
        baseUrl: environment.CRITIC_BASE_URL,
        apiKey: environment.CRITIC_API_KEY,
        model: environment.CRITIC_MODEL,
        supportsJsonSchema: environment.CRITIC_SUPPORTS_JSON_SCHEMA,
        role: "critic",
        keepAlive: environment.COMPLETION_KEEP_ALIVE,
      }),
  };
}
