import {
  CreateWritingRubricRequestSchema,
  UpdateWritingRubricRequestSchema,
} from "@openloop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Database } from "../db/client.js";
import {
  createWritingRubric,
  listWritingRubrics,
  updateWritingRubric,
} from "../writing-rubrics.js";

const RubricParamsSchema = z.object({ id: z.uuid() });

export function registerWritingRubricRoutes(
  server: FastifyInstance,
  database: Database,
): void {
  server.get("/v1/writing-rubrics", async () => ({
    rubrics: listWritingRubrics(database),
  }));

  server.post("/v1/writing-rubrics", async (request, reply) => {
    const input = CreateWritingRubricRequestSchema.parse(request.body);
    return reply.code(201).send(createWritingRubric(database, input));
  });

  server.put("/v1/writing-rubrics/:id", async (request) => {
    const { id } = RubricParamsSchema.parse(request.params);
    const input = UpdateWritingRubricRequestSchema.parse(request.body);
    return updateWritingRubric(database, id, input);
  });
}
