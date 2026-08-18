import Fastify from "fastify";

import type { Environment } from "./config/env.js";
import { CriticEventBroker } from "./critic-events.js";
import { CriticQueue } from "./critic-queue.js";
import { openDatabase, type Database } from "./db/client.js";
import { applyMigrations } from "./db/migrations.js";
import {
  selectModelAdapters,
  type SelectedModelAdapters,
} from "./models/provider.js";
import { registerCompletionRoutes } from "./routes/completions.js";
import { registerCriticRoutes } from "./routes/critic.js";
import { registerDocumentRoutes } from "./routes/documents.js";

interface BuildServerOptions {
  environment: Environment;
  database?: Database;
  logger?: boolean;
  selectedModel?: SelectedModelAdapters;
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

  const server = Fastify({ logger, pluginTimeout: 180_000 });
  const activeModel = selectedModel ?? selectModelAdapters(environment);
  if (activeModel.completion.warmup) {
    server.addHook("onReady", async () => {
      await activeModel.completion.warmup?.();
      server.log.info(
        { model: activeModel.completion.model },
        "Local autocomplete model ready",
      );
    });
  }
  const criticBroker = new CriticEventBroker();
  const criticQueue = new CriticQueue(
    activeDatabase,
    activeModel,
    criticBroker,
    server.log,
  );
  server.get("/v1/health", async () => ({ status: "ok" as const }));
  server.get("/v1/model-status", async () => {
    if (
      activeModel.completion.runtime.state === "unavailable" &&
      activeModel.completion.warmup
    ) {
      void activeModel.completion.warmup().catch(() => undefined);
    }
    return {
      provider: activeModel.completion.adapter.providerId,
      completionModel: activeModel.completion.model,
      criticProvider: activeModel.critic.adapter.providerId,
      criticModel: activeModel.critic.model,
      state: activeModel.completion.runtime.state,
      mode:
        activeModel.completion.adapter.providerId === "mock"
          ? "offline"
          : activeModel.completion.adapter.providerId === "ollama"
            ? "local"
            : "remote",
    };
  });
  registerDocumentRoutes(server, activeDatabase);
  registerCompletionRoutes(server, activeDatabase, activeModel);
  registerCriticRoutes(server, activeDatabase, criticQueue, criticBroker);

  server.addHook("onClose", async () => {
    await activeModel.completion.shutdown?.();
    if (ownsDatabase) {
      activeDatabase.sqlite.close();
    }
  });

  return server;
}
