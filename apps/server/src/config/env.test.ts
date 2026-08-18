import { describe, expect, it } from "vitest";

import { readEnvironment } from "./env.js";

describe("model environment", () => {
  it("accepts the standard OpenAI key and selects lightweight defaults", () => {
    const environment = readEnvironment({
      MODEL_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
    });

    expect(environment.MODEL_API_KEY).toBe("test-key");
    expect(environment.MODEL_FAST).toBe("gpt-5.6-luna");
    expect(environment.MODEL_SMART).toBe("gpt-5.6-terra");
  });

  it("still allows an explicit offline mock provider", () => {
    expect(readEnvironment({ MODEL_PROVIDER: "mock" }).MODEL_PROVIDER).toBe(
      "mock",
    );
  });
});
