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

  return {
    adapter: new OpenAICompatibleAdapter({
      baseUrl: environment.MODEL_BASE_URL,
      apiKey: environment.MODEL_API_KEY,
      fastModel: environment.MODEL_FAST,
      smartModel: environment.MODEL_SMART,
      supportsJsonSchema: environment.MODEL_SUPPORTS_JSON_SCHEMA,
    }),
    completionModel: environment.MODEL_FAST,
    criticModel: environment.MODEL_SMART,
  };
}
