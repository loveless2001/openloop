import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  COMPLETION_PROMPT_VERSION,
  ModelAdapterError,
} from "@openloop/model-adapters";
import {
  CompletionInteractionRequestSchema,
  CompletionStreamRequestSchema,
} from "@openloop/shared";
import type { FastifyInstance } from "fastify";

import type { Database } from "../db/client.js";
import { getDocument } from "../documents.js";
import { createCompletionModelRun, finishModelRun } from "../model-runs.js";
import type { SelectedModelAdapters } from "../models/provider.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function registerCompletionRoutes(
  server: FastifyInstance,
  database: Database,
  selectedModel: SelectedModelAdapters,
): void {
  server.post("/v1/completions/stream", async (request, reply) => {
    const input = CompletionStreamRequestSchema.parse(request.body);
    if (sha256(input.prefix) !== input.prefixHash) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "prefixHash does not match prefix.",
          requestId: request.id,
        },
      });
    }

    const document = getDocument(database, input.documentId);
    const inputHash = sha256(
      JSON.stringify({
        documentId: input.documentId,
        documentVersion: input.documentVersion,
        nodeId: input.nodeId,
        cursorOffset: input.cursorOffset,
        prefixHash: input.prefixHash,
      }),
    );
    const runId = createCompletionModelRun(database, {
      requestId: input.requestId,
      documentId: input.documentId,
      provider: selectedModel.completion.adapter.providerId,
      model: selectedModel.completion.model,
      inputHash,
    });
    const startedAt = performance.now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once("aborted", abort);
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) abort();
    });

    request.log.info(
      {
        modelRun: {
          requestId: input.requestId,
          provider: selectedModel.completion.adapter.providerId,
          model: selectedModel.completion.model,
          promptVersion: COMPLETION_PROMPT_VERSION,
          inputHash,
        },
      },
      "Completion model run started",
    );

    async function* streamEvents() {
      try {
        for await (const chunk of selectedModel.completion.adapter.streamCompletion(
          {
            requestId: input.requestId,
            documentTitle: document.title,
            headingPath: input.headingPath,
            prefix: input.prefix,
            suffix: input.suffix,
            maxOutputTokens: 60,
          },
          controller.signal,
        )) {
          if (chunk.textDelta) yield sse("delta", { text: chunk.textDelta });
          if (chunk.done) {
            yield sse("done", { requestId: input.requestId });
            break;
          }
        }
        const latencyMs = Math.round(performance.now() - startedAt);
        finishModelRun(database, { id: runId, status: "completed", latencyMs });
        request.log.info(
          {
            modelRun: {
              requestId: input.requestId,
              promptVersion: COMPLETION_PROMPT_VERSION,
              latencyMs,
              status: "completed",
            },
          },
          "Completion model run finished",
        );
      } catch (error) {
        const modelError =
          error instanceof ModelAdapterError
            ? error
            : new ModelAdapterError(
                "MODEL_UNAVAILABLE",
                "The completion provider failed.",
                {
                  cause: error,
                },
              );
        const latencyMs = Math.round(performance.now() - startedAt);
        finishModelRun(database, {
          id: runId,
          status: modelError.code === "MODEL_ABORTED" ? "aborted" : "error",
          latencyMs,
          errorCode: modelError.code,
        });
        yield sse("error", {
          code: modelError.code,
          message: modelError.message,
        });
      } finally {
        request.raw.removeListener("aborted", abort);
      }
    }

    return reply
      .header("content-type", "text/event-stream; charset=utf-8")
      .header("cache-control", "no-cache, no-transform")
      .header("connection", "keep-alive")
      .header("x-accel-buffering", "no")
      .send(Readable.from(streamEvents()));
  });

  server.post("/v1/completion-events", async (request, reply) => {
    const event = CompletionInteractionRequestSchema.parse(request.body);
    request.log.info(
      { completionEvent: event },
      "Completion interaction recorded",
    );
    return reply.code(202).send({ accepted: true });
  });
}
