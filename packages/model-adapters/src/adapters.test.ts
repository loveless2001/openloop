import { describe, expect, it, vi } from "vitest";

import { MockModelAdapter } from "./mock-adapter.js";
import { OpenAICompatibleAdapter } from "./openai-compatible-adapter.js";

function adapterWithFetch(fetchImplementation: typeof fetch) {
  return new OpenAICompatibleAdapter({
    baseUrl: "http://models.test/v1",
    apiKey: "test-key",
    fastModel: "fast",
    smartModel: "smart",
    supportsJsonSchema: false,
    fetchImplementation,
  });
}

const completionInput = {
  requestId: "0bd170b4-1c7e-49d0-9148-bce84acb54ea",
  headingPath: ["Architecture"],
  prefix: "The harness is model agnostic",
  maxOutputTokens: 60,
};

const criticInput = {
  requestId: "0bd170b4-1c7e-49d0-9148-bce84acb54ea",
  documentTitle: "Harness note",
  documentVersion: 1,
  changedBlocks: [],
  openIssues: [],
};

const validIssue = {
  type: "ambiguity",
  anchorQuote: "any model will work equally well",
  question: "Do you mean integration compatibility or equivalent quality?",
  rationale: "Those are distinct portability claims.",
  severity: 4,
  confidence: 0.9,
  interruptWorthiness: 0.9,
  resurfaceTriggers: ["claim_reused"],
  keywords: ["model", "quality"],
};

describe("MockModelAdapter", () => {
  it("streams a deterministic context-sensitive completion", async () => {
    const chunks: string[] = [];
    for await (const chunk of new MockModelAdapter().streamCompletion(
      completionInput,
      new AbortController().signal,
    )) {
      chunks.push(chunk.textDelta);
    }
    expect(chunks.join("")).toBe(
      " because interface compatibility does not guarantee equivalent quality.",
    );
  });

  it("stops streaming after cancellation", async () => {
    const controller = new AbortController();
    const stream = new MockModelAdapter().streamCompletion(
      completionInput,
      controller.signal,
    );
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({
      code: "MODEL_ABORTED",
    });
  });
});

describe("OpenAICompatibleAdapter", () => {
  it("streams OpenAI-compatible completion deltas", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":" hello"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
              "data: [DONE]\n\n",
          ),
        );
        controller.close();
      },
    });
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(stream, { status: 200 })),
    );
    const chunks: string[] = [];

    for await (const chunk of adapterWithFetch(
      fetchImplementation,
    ).streamCompletion(completionInput, new AbortController().signal)) {
      chunks.push(chunk.textDelta);
    }

    expect(chunks.join("")).toBe(" hello world");
    const requestBody = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    );
    expect(requestBody).toMatchObject({
      model: "fast",
      stream: true,
      max_tokens: 60,
    });
  });

  it("uses low-latency OpenAI parameters for the production fast model", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(new Response(stream, { status: 200 })),
    );
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      fastModel: "gpt-5.6-luna",
      smartModel: "gpt-5.6-terra",
      supportsJsonSchema: true,
      providerId: "openai",
      openAIRequestParameters: true,
      fetchImplementation,
    });

    for await (const chunk of adapter.streamCompletion(
      completionInput,
      new AbortController().signal,
    )) {
      expect(chunk.done).toBe(true);
    }

    const requestBody = JSON.parse(
      String(fetchImplementation.mock.calls[0]?.[1]?.body),
    );
    expect(adapter.providerId).toBe("openai");
    expect(requestBody).toMatchObject({
      model: "gpt-5.6-luna",
      max_completion_tokens: 60,
      reasoning_effort: "none",
      stream: true,
    });
    expect(requestBody).not.toHaveProperty("max_tokens");
  });

  it("strips Markdown fences and validates critic JSON", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        Response.json({
          choices: [
            {
              message: {
                content: `\`\`\`json\n${JSON.stringify([validIssue])}\n\`\`\``,
              },
            },
          ],
        }),
      ),
    );

    const issues = await adapterWithFetch(fetchImplementation).critique(
      criticInput,
      new AbortController().signal,
    );
    expect(issues).toEqual([validIssue]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("makes one repair request containing only invalid output and schema instructions", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: "not-json" } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: JSON.stringify([validIssue]) } }],
        }),
      );

    const issues = await adapterWithFetch(fetchImplementation).critique(
      { ...criticInput, documentTitle: "private original title" },
      new AbortController().signal,
    );
    expect(issues).toEqual([validIssue]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const repairBody = String(fetchImplementation.mock.calls[1]?.[1]?.body);
    expect(repairBody).toContain("not-json");
    expect(repairBody).not.toContain("private original title");
  });

  it("returns a typed error when the repair output is also malformed", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Promise.resolve(
        Response.json({ choices: [{ message: { content: "still-invalid" } }] }),
      ),
    );

    await expect(
      adapterWithFetch(fetchImplementation).critique(
        criticInput,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "MODEL_MALFORMED_OUTPUT" });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("maps an aborted request to MODEL_ABORTED", async () => {
    const fetchImplementation = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          {
            once: true,
          },
        );
      });
    });
    const controller = new AbortController();
    const pending = adapterWithFetch(fetchImplementation).critique(
      criticInput,
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "MODEL_ABORTED" });
  });

  it("maps the completion deadline to MODEL_TIMEOUT", async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi.fn<typeof fetch>((_input, init) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("deadline")),
            { once: true },
          );
        });
      });
      const stream = adapterWithFetch(fetchImplementation).streamCompletion(
        completionInput,
        new AbortController().signal,
      );
      const iterator = stream[Symbol.asyncIterator]();
      const pending = iterator.next();
      const outcome = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(8_001);
      expect(await outcome).toMatchObject({ code: "MODEL_TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });
});
