import { describe, expect, it } from "vitest";

import { readEnvironment } from "./env.js";

describe("model environment", () => {
  it("defaults autocomplete to the small local model and critic to mock", () => {
    const environment = readEnvironment({});

    expect(environment.COMPLETION_PROVIDER).toBe("ollama");
    expect(environment.COMPLETION_MODEL).toBe("qwen2.5:0.5b");
    expect(environment.COMPLETION_KEEP_ALIVE).toBe("30m");
    expect(environment.CRITIC_PROVIDER).toBe("mock");
    expect(environment.CRITIC_AGENT).toBe("codex");
    expect(environment.CRITIC_AGENT_COMMAND).toBe("");
    expect(environment.CRITIC_AGENT_JOB_TIMEOUT_MS).toBe(300_000);
    expect(environment.CAPTURE_TRAINING_TRACES).toBe(false);
  });

  it("requires an explicit opt-in for raw local training traces", () => {
    const environment = readEnvironment({
      CAPTURE_TRAINING_TRACES: "true",
      TRAINING_TRACE_PATH: "data/training/custom.jsonl",
    });

    expect(environment.CAPTURE_TRAINING_TRACES).toBe(true);
    expect(environment.TRAINING_TRACE_PATH).toBe("data/training/custom.jsonl");
  });

  it("accepts an independently configured remote critic", () => {
    const environment = readEnvironment({
      CRITIC_PROVIDER: "openai",
      CRITIC_API_KEY: "test-key",
    });

    expect(environment.COMPLETION_PROVIDER).toBe("ollama");
    expect(environment.CRITIC_API_KEY).toBe("test-key");
    expect(environment.CRITIC_MODEL).toBe("gpt-5.6-terra");
  });

  it("configures each role explicitly", () => {
    const environment = readEnvironment({
      COMPLETION_PROVIDER: "mock",
      CRITIC_PROVIDER: "mock",
    });
    expect(environment.COMPLETION_PROVIDER).toBe("mock");
    expect(environment.CRITIC_PROVIDER).toBe("mock");
  });

  it("allows the CLI agent only for the critic role", () => {
    expect(
      readEnvironment({ CRITIC_PROVIDER: "cli-agent" }).CRITIC_PROVIDER,
    ).toBe("cli-agent");
    expect(() =>
      readEnvironment({ COMPLETION_PROVIDER: "cli-agent" }),
    ).toThrow();
  });
});
