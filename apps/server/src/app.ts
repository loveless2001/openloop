import Fastify from "fastify";

import type { Environment } from "./config/env.js";
import { openDatabase, type Database } from "./db/client.js";
import { applyMigrations } from "./db/migrations.js";
import { registerDocumentRoutes } from "./routes/documents.js";

interface BuildServerOptions {
  environment: Environment;
  database?: Database;
  logger?: boolean;
}

export function buildServer({
  environment,
  database,
  logger = true,
}: BuildServerOptions) {
  const ownsDatabase = database === undefined;
  const activeDatabase = database ?? openDatabase(environment.DATABASE_URL);
  applyMigrations(activeDatabase);

  const server = Fastify({ logger });
  server.get("/v1/health", async () => ({ status: "ok" as const }));
  registerDocumentRoutes(server, activeDatabase);

  if (ownsDatabase) {
    server.addHook("onClose", async () => {
      activeDatabase.sqlite.close();
    });
  }

  return server;
}
