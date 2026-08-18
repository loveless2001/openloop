import Fastify from "fastify";

import type { Environment } from "./config/env.js";
import { CriticEventBroker } from "./critic-events.js";
import { CriticQueue } from "./critic-queue.js";
import { openDatabase, type Database } from "./db/client.js";
import { applyMigrations } from "./db/migrations.js";
import {
  selectModelAdapter,
  type SelectedModelAdapter,
} from "./models/provider.js";
import { registerCompletionRoutes } from "./routes/completions.js";
import { registerCriticRoutes } from "./routes/critic.js";
import { registerDocumentRoutes } from "./routes/documents.js";

interface BuildServerOptions {
  environment: Environment;
  database?: Database;
  logger?: boolean;
  selectedModel?: SelectedModelAdapter;
}

export function buildServer({
  environment,
  database,
  logger = true,
  selectedModel,
}: BuildServerOptions) {
  const ownsDatabase = database === undefined;
  const activeDatabase = database ?? openDatabase(environment.DATABASE_URL);
  applyMigrations(activeDatabase);

  const server = Fastify({ logger });
  const activeModel = selectedModel ?? selectModelAdapter(environment);
  const criticBroker = new CriticEventBroker();
  const criticQueue = new CriticQueue(
    activeDatabase,
    activeModel,
    criticBroker,
    server.log,
  );
  server.get("/v1/health", async () => ({ status: "ok" as const }));
  registerDocumentRoutes(server, activeDatabase);
  registerCompletionRoutes(server, activeDatabase, activeModel);
  registerCriticRoutes(server, activeDatabase, criticQueue, criticBroker);

  if (ownsDatabase) {
    server.addHook("onClose", async () => {
      activeDatabase.sqlite.close();
    });
  }

  return server;
}
