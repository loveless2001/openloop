import { IssueCandidateSchema, ReconcileResultSchema } from "@openloop/shared";
import { z } from "zod";

import { ModelAdapterError } from "./model-error.js";
import { requestStructuredJson } from "./openai-json-client.js";
import {
  buildCompletionPrompt,
  completionSystemPrompt,
} from "./prompts/completion.v1.js";
import { buildCriticPrompt, criticSystemPrompt } from "./prompts/critic.v1.js";
import {
  buildReconcilePrompt,
  reconcileSystemPrompt,
} from "./prompts/reconcile.v1.js";
import {
  assertSuccessfulResponse,
  mapRequestError,
  requestSignal,
} from "./request-control.js";
import type {
  CompletionChunk,
  CompletionInput,
  CriticInput,
  ModelAdapter,
  ReconcileInput,
} from "./types.js";

const streamChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({ content: z.string().nullable().optional() }),
    }),
  ),
});

const criticResultSchema = z.array(IssueCandidateSchema).max(3);

export interface OpenAICompatibleAdapterConfig {
  baseUrl: string;
  apiKey: string;
  fastModel: string;
  smartModel: string;
  supportsJsonSchema: boolean;
  providerId?: string;
  openAIRequestParameters?: boolean;
  fetchImplementation?: typeof fetch;
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly providerId: string;
  readonly capabilities: ModelAdapter["capabilities"];
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly config: OpenAICompatibleAdapterConfig) {
    this.providerId = config.providerId ?? "openai-compatible";
    this.fetchImplementation = config.fetchImplementation ?? fetch;
    this.capabilities = {
      streaming: true,
      jsonSchema: config.supportsJsonSchema,
      cancellation: true,
    };
  }

  async *streamCompletion(
    input: CompletionInput,
    externalSignal: AbortSignal,
  ): AsyncIterable<CompletionChunk> {
    const activeSignal = requestSignal(externalSignal, 8_000);
    let emittedDone = false;

    try {
      const response = await this.fetchImplementation(this.endpoint(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.config.fastModel,
          messages: [
            { role: "system", content: completionSystemPrompt },
            { role: "user", content: buildCompletionPrompt(input) },
          ],
          temperature: 0.2,
          ...(this.config.openAIRequestParameters
            ? {
                max_completion_tokens: input.maxOutputTokens,
                reasoning_effort: "none",
              }
            : { max_tokens: input.maxOutputTokens }),
          stream: true,
        }),
        signal: activeSignal.signal,
      });
      assertSuccessfulResponse(response);
      if (!response.body) {
        throw new ModelAdapterError(
          "MODEL_UNAVAILABLE",
          "The model provider returned no response stream.",
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
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            emittedDone = true;
            yield { textDelta: "", done: true };
            return;
          }
          if (!data) continue;

          let parsed: z.infer<typeof streamChunkSchema>;
          try {
            parsed = streamChunkSchema.parse(JSON.parse(data));
          } catch (error) {
            throw new ModelAdapterError(
              "MODEL_MALFORMED_OUTPUT",
              "The model returned a malformed completion chunk.",
              { cause: error },
            );
          }
          const textDelta = parsed.choices[0]?.delta.content ?? "";
          if (textDelta) yield { textDelta, done: false };
        }

        if (done) break;
      }

      if (!emittedDone) yield { textDelta: "", done: true };
    } catch (error) {
      throw mapRequestError(error, activeSignal, externalSignal);
    } finally {
      activeSignal.cleanup();
    }
  }

  async critique(input: CriticInput, signal: AbortSignal) {
    return requestStructuredJson(this.jsonTransport(), {
      model: this.config.smartModel,
      systemPrompt: criticSystemPrompt,
      userPrompt: buildCriticPrompt(input),
      schema: criticResultSchema,
      schemaName: "critic_issues",
      schemaInstructions:
        "A JSON array containing no more than three issue candidates.",
      timeoutMs: 30_000,
      signal,
    });
  }

  async reconcile(input: ReconcileInput, signal: AbortSignal) {
    return requestStructuredJson(this.jsonTransport(), {
      model: this.config.smartModel,
      systemPrompt: reconcileSystemPrompt,
      userPrompt: buildReconcilePrompt(input),
      schema: ReconcileResultSchema,
      schemaName: "reconcile_result",
      schemaInstructions:
        "A JSON object with outcome, reason, optional newAnchorQuote, and confidence.",
      timeoutMs: 20_000,
      signal,
    });
  }

  private endpoint(): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  }

  private headers(): HeadersInit {
    return {
      ...(this.config.apiKey
        ? { authorization: `Bearer ${this.config.apiKey}` }
        : {}),
      "content-type": "application/json",
    };
  }

  private jsonTransport() {
    return {
      endpoint: this.endpoint(),
      headers: this.headers(),
      supportsJsonSchema: this.config.supportsJsonSchema,
      fetchImplementation: this.fetchImplementation,
    };
  }
}
