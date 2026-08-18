import { PassThrough } from "node:stream";

import {
  CriticJobRequestSchema,
  IssueActionRequestSchema,
  IssueStatus,
} from "@openloop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { CriticEvent, CriticEventBroker } from "../critic-events.js";
import { CriticQueueFullError } from "../critic-queue.js";
import type { CriticQueue } from "../critic-queue.js";
import type { Database } from "../db/client.js";
import { getDocument } from "../documents.js";
import {
  applyIssueAction,
  IssueActionConflictError,
  IssueNotFoundError,
  listIssueEvents,
  listIssues,
} from "../issues.js";

const DocumentParamsSchema = z.object({ documentId: z.uuid() });
const IssueParamsSchema = z.object({ issueId: z.uuid() });
const IssueQuerySchema = z.object({ status: z.string().optional() });

function sse(event: CriticEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export function registerCriticRoutes(
  server: FastifyInstance,
  database: Database,
  queue: CriticQueue,
  broker: CriticEventBroker,
): void {
  server.post(
    "/v1/documents/:documentId/critic-jobs",
    async (request, reply) => {
      const { documentId } = DocumentParamsSchema.parse(request.params);
      getDocument(database, documentId);
      const input = CriticJobRequestSchema.parse(request.body);
      try {
        return reply
          .code(202)
          .send({ jobId: queue.enqueue(documentId, input), status: "queued" });
      } catch (error) {
        if (error instanceof CriticQueueFullError) {
          return reply.code(429).send({
            error: {
              code: error.code,
              message: error.message,
              requestId: request.id,
            },
          });
        }
        throw error;
      }
    },
  );

  server.get(
    "/v1/documents/:documentId/critic-events",
    async (request, reply) => {
      const { documentId } = DocumentParamsSchema.parse(request.params);
      getDocument(database, documentId);
      const stream = new PassThrough();
      stream.write("retry: 2000\n\n");
      const unsubscribe = broker.subscribe(documentId, (event) => {
        stream.write(sse(event));
      });
      const heartbeat = setInterval(
        () => stream.write(": keepalive\n\n"),
        15_000,
      );
      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        if (!stream.destroyed) stream.end();
      };
      request.raw.once("aborted", close);
      reply.raw.once("close", close);
      return reply
        .header("content-type", "text/event-stream; charset=utf-8")
        .header("cache-control", "no-cache, no-transform")
        .header("connection", "keep-alive")
        .header("x-accel-buffering", "no")
        .send(stream);
    },
  );

  server.get("/v1/documents/:documentId/issues", async (request) => {
    const { documentId } = DocumentParamsSchema.parse(request.params);
    getDocument(database, documentId);
    const { status } = IssueQuerySchema.parse(request.query);
    const statuses = status
      ? status.split(",").map((value) => IssueStatus.parse(value))
      : undefined;
    return { issues: listIssues(database, documentId, statuses) };
  });

  server.get("/v1/issues/:issueId/events", async (request) => {
    const { issueId } = IssueParamsSchema.parse(request.params);
    return { events: listIssueEvents(database, issueId) };
  });

  server.post("/v1/issues/:issueId/actions", async (request, reply) => {
    const { issueId } = IssueParamsSchema.parse(request.params);
    const input = IssueActionRequestSchema.parse(request.body);
    try {
      const result = applyIssueAction(database, issueId, input);
      broker.emit(result.issue.documentId, {
        event:
          result.issue.status === "resolved"
            ? "issue_resolved"
            : result.issue.status === "invalidated"
              ? "issue_invalidated"
              : "issue_updated",
        data: { issue: result.issue, jobId: request.id },
      });
      return result;
    } catch (error) {
      if (error instanceof IssueNotFoundError) {
        return reply.code(404).send({
          error: {
            code: error.code,
            message: error.message,
            requestId: request.id,
          },
        });
      }
      if (error instanceof IssueActionConflictError) {
        return reply.code(409).send({
          error: {
            code: error.code,
            message: error.message,
            requestId: request.id,
          },
        });
      }
      throw error;
    }
  });
}
