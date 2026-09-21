import type { CompiledWritingEvaluation } from "@openloop/shared";
import { describe, expect, it, vi } from "vitest";

import {
  TypeSafeWritingEvaluator,
  WritingEvaluatorError,
} from "./typesafe-writing-evaluator.js";

const request = {
  model: "jev-1.13.0",
  state: {
    target: { scope: "selection", text: "A concise reviewed passage." },
    context: { before: "Before.", after: "After." },
    writing_goal: { purpose: "Explain clearly.", audience: "Readers" },
    language_hint: "en",
  },
  questions: {
    criterion_test__score: {
      type: "score",
      instructions: "Evaluate only target.text for clarity.",
      criteria: ["Unclear", "Partly clear", "Clear"],
    },
    criterion_test__assessability: {
      type: "choice",
      instructions: "Can the target be assessed for clarity?",
      criteria: {
        assessable: "The target can be assessed.",
        needs_context: "Essential context is missing.",
        not_applicable: "The criterion does not apply.",
      },
    },
  },
} as const;

const compiled = { request } as unknown as CompiledWritingEvaluation;

const nativeResponse = {
  model: "jev-1.13.0",
  answers: {
    criterion_test__score: {
      type: "score",
      score: 1.7,
      confidence: 0.8,
      legend: { "0": "Unclear", "1": "Partly clear", "2": "Clear" },
      probabilities: { "0": 0.05, "1": 0.2, "2": 0.75 },
    },
    criterion_test__assessability: {
      type: "choice",
      choice: "assessable",
      confidence: 0.9,
      probabilities: {
        assessable: 0.9,
        needs_context: 0.06,
        not_applicable: 0.04,
      },
    },
  },
  usage: { input_tokens: 123, output_tokens: 45 },
  request_id: "provider-metadata-is-ignored",
};

describe("TypeSafeWritingEvaluator", () => {
  it("sends the compiled System One payload in the official SDK wire format", async () => {
    let captured:
      | {
          input: Parameters<typeof fetch>[0];
          init: Parameters<typeof fetch>[1];
        }
      | undefined;
    const fetchImplementation: typeof fetch = vi.fn(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        captured = { input, init };
        return new Response(JSON.stringify(nativeResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const evaluator = new TypeSafeWritingEvaluator({
      apiKey: "test-secret",
      baseUrl: "https://api.typesafe.ai/v1",
      timeoutMs: 1_000,
      fetchImplementation,
    });

    const result = await evaluator.evaluate(
      compiled,
      new AbortController().signal,
    );

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(captured?.input).toBe("https://api.typesafe.ai/v1/systemone");
    expect(captured?.init).toMatchObject({
      method: "POST",
      redirect: "manual",
    });
    expect(new Headers(captured?.init?.headers).get("authorization")).toBe(
      "Bearer test-secret",
    );
    expect(JSON.parse(String(captured?.init?.body))).toEqual(request);
    expect(JSON.parse(String(captured?.init?.body))).not.toHaveProperty(
      "messages",
    );
    expect(result).toMatchObject({
      model: "jev-1.13.0",
      usage: { inputTokens: 123, outputTokens: 45 },
    });
  });

  it.each([
    [401, "EVALUATOR_AUTH"],
    [403, "EVALUATOR_AUTH"],
    [413, "EVALUATION_TOO_LARGE"],
    [422, "EVALUATOR_INVALID_RESPONSE"],
    [503, "EVALUATOR_UNAVAILABLE"],
  ] as const)(
    "maps HTTP %s without reading an upstream body",
    async (status, code) => {
      const response = new Response("sensitive echoed source", { status });
      const json = vi.spyOn(response, "json");
      const evaluator = new TypeSafeWritingEvaluator({
        apiKey: "test-secret",
        baseUrl: "https://api.typesafe.ai/v1",
        timeoutMs: 1_000,
        fetchImplementation: vi.fn(async () => response),
      });

      await expect(
        evaluator.evaluate(compiled, new AbortController().signal),
      ).rejects.toMatchObject({ code });
      expect(json).not.toHaveBeenCalled();
    },
  );

  it("preserves only a sanitized numeric retry hint and never retries", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response("ignored", {
          status: 429,
          headers: { "retry-after": "12" },
        }),
    );
    const evaluator = new TypeSafeWritingEvaluator({
      apiKey: "test-secret",
      baseUrl: "https://api.typesafe.ai/v1",
      timeoutMs: 1_000,
      fetchImplementation,
    });

    await expect(
      evaluator.evaluate(compiled, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "EVALUATOR_RATE_LIMITED",
      message: expect.stringContaining("12 seconds"),
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed native usage and times out a single attempt", async () => {
    const malformed = new TypeSafeWritingEvaluator({
      apiKey: "test-secret",
      baseUrl: "https://api.typesafe.ai/v1",
      timeoutMs: 1_000,
      fetchImplementation: vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ...nativeResponse, usage: { inputTokens: 1 } }),
            { status: 200 },
          ),
      ),
    });
    await expect(
      malformed.evaluate(compiled, new AbortController().signal),
    ).rejects.toMatchObject({ code: "EVALUATOR_INVALID_RESPONSE" });

    const waitingFetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const timed = new TypeSafeWritingEvaluator({
      apiKey: "test-secret",
      baseUrl: "https://api.typesafe.ai/v1",
      timeoutMs: 5,
      fetchImplementation: waitingFetch,
    });
    await expect(
      timed.evaluate(compiled, new AbortController().signal),
    ).rejects.toMatchObject({ code: "EVALUATOR_TIMEOUT" });
    expect(waitingFetch).toHaveBeenCalledTimes(1);
  });

  it("requires HTTPS except for an explicitly enabled test loopback", () => {
    expect(
      () =>
        new TypeSafeWritingEvaluator({
          apiKey: "test-secret",
          baseUrl: "http://example.com/v1",
          timeoutMs: 1_000,
        }),
    ).toThrow(WritingEvaluatorError);
    expect(
      () =>
        new TypeSafeWritingEvaluator({
          apiKey: "test-secret",
          baseUrl: "http://127.0.0.1:9999/v1",
          timeoutMs: 1_000,
          allowInsecureLoopback: true,
        }),
    ).not.toThrow();
  });
});
