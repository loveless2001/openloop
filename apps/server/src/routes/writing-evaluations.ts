import {
  CreateEvaluationRequestSchema,
  EvaluationIntentSchema,
} from "@openloop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { WritingEvaluationService } from "../writing-evaluation-service.js";

const DocumentParamsSchema = z.object({ id: z.uuid() });
const RunParamsSchema = z.object({ runId: z.uuid() });
const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export function registerWritingEvaluationRoutes(
  server: FastifyInstance,
  evaluations: WritingEvaluationService,
): void {
  server.get("/v1/evaluator-status", async () => evaluations.status());

  server.post("/v1/documents/:id/evaluations/preview", async (request) => {
    const { id } = DocumentParamsSchema.parse(request.params);
    const intent = EvaluationIntentSchema.parse(request.body);
    return evaluations.prepare(id, intent);
  });

  server.post("/v1/documents/:id/evaluations", async (request, reply) => {
    const { id } = DocumentParamsSchema.parse(request.params);
    const input = CreateEvaluationRequestSchema.parse(request.body);
    return reply.code(202).send(evaluations.submit(id, input));
  });

  server.get("/v1/documents/:id/evaluations", async (request) => {
    const { id } = DocumentParamsSchema.parse(request.params);
    const { limit, offset } = ListQuerySchema.parse(request.query);
    return { runs: evaluations.list(id, limit, offset) };
  });

  server.get("/v1/evaluations/:runId", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    return evaluations.get(runId);
  });

  server.post("/v1/evaluations/:runId/cancel", async (request) => {
    const { runId } = RunParamsSchema.parse(request.params);
    return evaluations.cancel(runId);
  });

  server.delete("/v1/evaluations/:runId", async (request, reply) => {
    const { runId } = RunParamsSchema.parse(request.params);
    evaluations.delete(runId);
    return reply.code(204).send();
  });
}
