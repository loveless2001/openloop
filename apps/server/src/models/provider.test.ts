import { describe, expect, it } from "vitest";

import { readEnvironment } from "../config/env.js";
import { selectModelAdapters } from "./provider.js";

describe("model role selection", () => {
  it("routes completion locally and keeps the critic independently mocked", () => {
    const selected = selectModelAdapters(readEnvironment({}));

    expect(selected.completion.adapter.providerId).toBe("ollama");
    expect(selected.completion.model).toBe("qwen2.5:0.5b");
    expect(selected.critic.adapter.providerId).toBe("mock");
    expect(selected.critic.model).toBe("mock-smart-v1");
  });

  it("can pair local completion with a remote OpenAI critic", () => {
    const selected = selectModelAdapters(
      readEnvironment({
        CRITIC_PROVIDER: "openai",
        CRITIC_API_KEY: "test-key",
      }),
    );

    expect(selected.completion.adapter.providerId).toBe("ollama");
    expect(selected.critic.adapter.providerId).toBe("openai");
    expect(selected.critic.model).toBe("gpt-5.6-terra");
  });

  it("requires a server-owned adapter for the CLI critic", () => {
    expect(() =>
      selectModelAdapters(readEnvironment({ CRITIC_PROVIDER: "cli-agent" })),
    ).toThrow("server-owned adapter");
  });
});
