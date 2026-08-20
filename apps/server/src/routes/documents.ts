import {
  CreateDocumentRequestSchema,
  SaveDocumentRequestSchema,
} from "@openloop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createDocument,
  DocumentNotFoundError,
  DocumentVersionConflictError,
  getDocument,
  saveDocument,
} from "../documents.js";
import type { Database } from "../db/client.js";
import type { CriticEventBroker } from "../critic-events.js";
import type { ReconciliationQueue } from "../reconciliation-queue.js";
import { remapImpactedIssues } from "../reconciliation.js";
import { IssueNotFoundError, listIssues } from "../issues.js";

const DocumentParamsSchema = z.object({ documentId: z.uuid() });

export function registerDocumentRoutes(
  server: FastifyInstance,
  database: Database,
  reconciliationQueue: ReconciliationQueue,
  broker: CriticEventBroker,
): void {
  server.post("/v1/documents", async (request, reply) => {
    const input = CreateDocumentRequestSchema.parse(request.body);
    return reply.code(201).send(createDocument(database, input));
  });

  server.get("/v1/documents/:documentId", async (request) => {
    const { documentId } = DocumentParamsSchema.parse(request.params);
    return {
      document: getDocument(database, documentId),
      issues: listIssues(database, documentId),
      preferences: [],
    };
  });

  server.put("/v1/documents/:documentId", async (request) => {
    const { documentId } = DocumentParamsSchema.parse(request.params);
    const input = SaveDocumentRequestSchema.parse(request.body);
    const previousDocument = getDocument(database, documentId);
    const result = database.sqlite.transaction(() => {
      const document = saveDocument(database, documentId, input);
      const remapped = remapImpactedIssues(database, {
        previousDocument,
        currentDocument: document,
        changeBatch: input.changeBatch,
      });
      return { document, ...remapped };
    })();
    for (const issue of result.updatedIssues) {
      broker.emit(documentId, {
        event: "issue_updated",
        data: { issue, jobId: request.id },
      });
    }
    if (result.impactedIssueIds.length > 0) {
      reconciliationQueue.enqueue({
        documentId,
        documentVersion: result.document.version,
        issueIds: result.impactedIssueIds,
        changedBlocks: input.changeBatch.changedBlocks,
      });
    }
    return {
      document: result.document,
      impactedIssueIds: result.impactedIssueIds,
    };
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof DocumentNotFoundError) {
      return reply.code(404).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (error instanceof DocumentVersionConflictError) {
      return reply.code(409).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          details: { currentVersion: error.currentVersion },
        },
      });
    }
    if (error instanceof IssueNotFoundError) {
      return reply.code(404).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          requestId: request.id,
          details: z.treeifyError(error),
        },
      });
    }

    request.log.error({ err: error }, "Request failed");
    return reply.code(500).send({
      error: {
        code: "DATABASE_ERROR",
        message: "Request failed.",
        requestId: request.id,
      },
    });
  });
}
