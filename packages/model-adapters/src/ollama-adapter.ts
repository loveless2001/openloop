import { z } from "zod";

import { ModelAdapterError } from "./model-error.js";
import {
  buildCausalCompletionPrefix,
  OLLAMA_CAUSAL_PROMPT_VERSION,
} from "./prompts/causal-prefix.v1.js";
import {
  assertSuccessfulResponse,
  mapRequestError,
  requestSignal,
} from "./request-control.js";
import type {
  CompletionChunk,
  CompletionInput,
  ModelAdapter,
} from "./types.js";

const ollamaChunkSchema = z.object({
  response: z.string(),
  done: z.boolean(),
});

export { OLLAMA_CAUSAL_PROMPT_VERSION };

export interface OllamaModelAdapterConfig {
  baseUrl: string;
  model: string;
  keepAlive: string;
  contextTokens?: number;
  fetchImplementation?: typeof fetch;
}

export class OllamaModelAdapter implements ModelAdapter {
  readonly providerId = "ollama";
  readonly capabilities = {
    streaming: true,
    jsonSchema: false,
    cancellation: true,
  } as const;
  private readonly fetchImplementation: typeof fetch;
  private readonly contextTokens: number;

  constructor(private readonly config: OllamaModelAdapterConfig) {
    this.fetchImplementation = config.fetchImplementation ?? fetch;
    this.contextTokens = config.contextTokens ?? 2_048;
  }

  async warmup(): Promise<void> {
    const response = await this.fetchImplementation(
      `${this.baseUrl()}/api/generate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          prompt: "Warm",
          raw: true,
          stream: false,
          keep_alive: this.config.keepAlive,
          options: { num_ctx: this.contextTokens, num_predict: 1 },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    assertSuccessfulResponse(response);
  }

  async *streamCompletion(
    input: CompletionInput,
    externalSignal: AbortSignal,
  ): AsyncIterable<CompletionChunk> {
    const activeSignal = requestSignal(externalSignal, 8_000);
    const prefix = buildCausalCompletionPrefix(input);
    let emittedText = false;
    const normalizeFirstDelta = (delta: string): string => {
      if (!delta || emittedText) return delta;
      emittedText = true;
      return /[\p{L}\p{N}]$/u.test(prefix) && /^[\p{L}\p{N}]/u.test(delta)
        ? ` ${delta}`
        : delta;
    };
    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl()}/api/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            prompt: prefix,
            raw: true,
            stream: true,
            keep_alive: this.config.keepAlive,
            options: {
              num_ctx: this.contextTokens,
              num_predict: input.maxOutputTokens,
              temperature: 0,
              stop: ["\n\n"],
            },
          }),
          signal: activeSignal.signal,
        },
      );
      assertSuccessfulResponse(response);
      if (!response.body) {
        throw new ModelAdapterError(
          "MODEL_UNAVAILABLE",
          "Ollama returned no response stream.",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = ollamaChunkSchema.parse(JSON.parse(line));
          if (chunk.response) {
            const textDelta = normalizeFirstDelta(chunk.response);
            if (textDelta) yield { textDelta, done: false };
          }
          if (chunk.done) {
            yield { textDelta: "", done: true };
            return;
          }
        }
        if (done) break;
      }
      yield { textDelta: "", done: true };
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new ModelAdapterError(
          "MODEL_MALFORMED_OUTPUT",
          "Ollama returned a malformed stream chunk.",
          { cause: error },
        );
      }
      throw mapRequestError(error, activeSignal, externalSignal);
    } finally {
      activeSignal.cleanup();
    }
  }

  async critique(): Promise<never> {
    throw new ModelAdapterError(
      "MODEL_UNAVAILABLE",
      "The local autocomplete adapter does not run critic jobs.",
    );
  }

  async reconcile(): Promise<never> {
    throw new ModelAdapterError(
      "MODEL_UNAVAILABLE",
      "The local autocomplete adapter does not run reconciliation.",
    );
  }

  private baseUrl(): string {
    return this.config.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  }
}
