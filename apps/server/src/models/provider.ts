import {
  MockModelAdapter,
  OpenAICompatibleAdapter,
  type ModelAdapter,
} from "@openloop/model-adapters";

import type { Environment } from "../config/env.js";

export interface SelectedModelAdapter {
  adapter: ModelAdapter;
  completionModel: string;
  criticModel: string;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function selectModelAdapter(
  environment: Environment,
): SelectedModelAdapter {
  if (environment.MODEL_PROVIDER === "mock") {
    return {
      adapter: new MockModelAdapter(),
      completionModel: "mock-fast-v1",
      criticModel: "mock-smart-v1",
    };
  }

  const isOpenAI = environment.MODEL_PROVIDER === "openai";

  return {
    adapter: new OpenAICompatibleAdapter({
      baseUrl: isOpenAI ? OPENAI_BASE_URL : environment.MODEL_BASE_URL,
      apiKey: environment.MODEL_API_KEY,
      fastModel: environment.MODEL_FAST,
      smartModel: environment.MODEL_SMART,
      supportsJsonSchema: isOpenAI
        ? true
        : environment.MODEL_SUPPORTS_JSON_SCHEMA,
      providerId: isOpenAI ? "openai" : "openai-compatible",
      openAIRequestParameters: isOpenAI,
    }),
    completionModel: environment.MODEL_FAST,
    criticModel: environment.MODEL_SMART,
  };
}
