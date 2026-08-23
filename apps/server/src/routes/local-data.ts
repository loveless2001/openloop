import type { FastifyInstance } from "fastify";

import type { Database } from "../db/client.js";
import { deleteLocalData } from "../local-data.js";
import type { TrainingTraceWriter } from "../training-traces.js";

export function registerLocalDataRoutes(
  server: FastifyInstance,
  database: Database,
  trainingTraceWriter: TrainingTraceWriter,
): void {
  server.delete("/v1/local-data", async (_request, reply) => {
    deleteLocalData(database);
    await trainingTraceWriter.deleteLocalData();
    return reply.send({ deleted: true as const });
  });
}
