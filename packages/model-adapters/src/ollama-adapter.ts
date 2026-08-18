import { z } from "zod";

import { ModelAdapterError } from "./model-error.js";
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
  message: z.object({ content: z.string() }).optional(),
  done: z.boolean(),
});

const ollamaCompletionSystemPrompt =
  "You are an inline autocomplete engine. Return only a short continuation; never repeat the supplied text.";

function buildOllamaCompletionPrompt(input: CompletionInput): string {
  const prefix = input.prefix.slice(-1_500);
  if (input.suffix) {
    return `Complete this passage. Answer with only the text missing at the blank:\n${prefix} ___ ${input.suffix.slice(0, 300)}`;
  }
  return `Complete this sentence. Answer with only the missing ending:\n${prefix} ___`;
}

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
          prompt: "",
          stream: false,
          keep_alive: this.config.keepAlive,
          options: { num_ctx: this.contextTokens, num_predict: 0 },
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
    const prefix = input.prefix.slice(-1_500);
    let undecidedText = "";
    let echoDecisionMade = false;
    let emittedText = false;
    const prepareText = (delta: string, final = false): string => {
      if (echoDecisionMade) return delta;
      undecidedText += delta;
      if (prefix.startsWith(undecidedText)) {
        if (!final) return "";
        undecidedText = "";
        echoDecisionMade = true;
        return "";
      }
      const result = undecidedText.startsWith(prefix)
        ? undecidedText.slice(prefix.length)
        : undecidedText;
      undecidedText = "";
      echoDecisionMade = true;
      return result;
    };
    const normalizeFirstDelta = (delta: string): string => {
      if (!delta || emittedText) return delta;
      emittedText = true;
      return /[\p{L}\p{N}]$/u.test(prefix) && /^[\p{L}\p{N}]/u.test(delta)
        ? ` ${delta}`
        : delta;
    };
    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl()}/api/chat`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: "system", content: ollamaCompletionSystemPrompt },
              { role: "user", content: buildOllamaCompletionPrompt(input) },
            ],
            stream: true,
            keep_alive: this.config.keepAlive,
            options: {
              num_ctx: this.contextTokens,
              num_predict: input.maxOutputTokens,
              temperature: 0.2,
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
          if (chunk.message?.content) {
            const textDelta = normalizeFirstDelta(
              prepareText(chunk.message.content),
            );
            if (textDelta) yield { textDelta, done: false };
          }
          if (chunk.done) {
            const textDelta = normalizeFirstDelta(prepareText("", true));
            if (textDelta) yield { textDelta, done: false };
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
