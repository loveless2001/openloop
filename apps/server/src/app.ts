import Fastify from "fastify";

import type { Environment } from "./config/env.js";
import { findWorkspaceRoot } from "./config/workspace.js";
import { CriticAgentBroker } from "./critic-agent-broker.js";
import { CriticCliCoordinator } from "./critic-cli-coordinator.js";
import {
  createCriticAgentLaunchConfig,
  loadOrCreateCriticMcpToken,
} from "./critic-agent-launch-config.js";
import {
  CriticAgentSupervisor,
  type CriticAgentController,
} from "./critic-agent-supervisor.js";
import { CriticEventBroker } from "./critic-events.js";
import { CriticQueue } from "./critic-queue.js";
import { ReconciliationQueue } from "./reconciliation-queue.js";
import { openDatabase, type Database } from "./db/client.js";
import { applyMigrations } from "./db/migrations.js";
import {
  selectModelAdapters,
  type SelectedModelAdapters,
} from "./models/provider.js";
import { CliCriticAdapter } from "./models/cli-critic-adapter.js";
import { registerCompletionRoutes } from "./routes/completions.js";
import { registerCriticAgentRoutes } from "./routes/critic-agent.js";
import { registerCriticRoutes } from "./routes/critic.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerIssueChatRoutes } from "./routes/issue-chat.js";
import { TrainingTraceWriter } from "./training-traces.js";
import { registerCriticMcpRoute } from "./critic-mcp.js";
import { IssueChatAgentBroker } from "./issue-chat-agent-broker.js";

interface BuildServerOptions {
  environment: Environment;
  database?: Database;
  logger?: boolean;
  selectedModel?: SelectedModelAdapters;
  trainingTraceWriter?: TrainingTraceWriter;
  criticAgentSupervisor?: CriticAgentController;
  criticAgentBroker?: CriticAgentBroker;
  issueChatAgentBroker?: IssueChatAgentBroker;
  mcpBearerToken?: string;
  reconciliationIdleMs?: number;
}

export function buildServer({
  environment,
  database,
  logger = true,
  selectedModel,
  trainingTraceWriter,
  criticAgentSupervisor,
  criticAgentBroker,
  issueChatAgentBroker,
  mcpBearerToken,
  reconciliationIdleMs,
}: BuildServerOptions) {
  const ownsDatabase = database === undefined;
  const activeDatabase = database ?? openDatabase(environment.DATABASE_URL);
  applyMigrations(activeDatabase);

  const server = Fastify({ logger, pluginTimeout: 180_000 });
  const workspaceRoot = findWorkspaceRoot();
  const activeMcpBearerToken =
    mcpBearerToken ?? loadOrCreateCriticMcpToken(workspaceRoot);
  const activeCriticAgentBroker =
    criticAgentBroker ??
    new CriticAgentBroker(environment.CRITIC_AGENT_JOB_TIMEOUT_MS);
  const activeIssueChatAgentBroker =
    issueChatAgentBroker ??
    new IssueChatAgentBroker(environment.CRITIC_AGENT_JOB_TIMEOUT_MS);
  const criticAgentLaunchConfig = createCriticAgentLaunchConfig({
    environment,
    bearerToken: activeMcpBearerToken,
    workspaceRoot,
  });
  const activeTrainingTraceWriter =
    trainingTraceWriter ??
    new TrainingTraceWriter({
      enabled: environment.CAPTURE_TRAINING_TRACES,
      path: environment.TRAINING_TRACE_PATH,
    });
  const activeCriticAgentSupervisor =
    criticAgentSupervisor ??
    new CriticAgentSupervisor({
      agent: environment.CRITIC_AGENT,
      command: environment.CRITIC_AGENT_COMMAND || environment.CRITIC_AGENT,
      cwd: criticAgentLaunchConfig.workingDirectory,
      args: criticAgentLaunchConfig.args,
      environment: criticAgentLaunchConfig.environment,
    });
  const criticCliCoordinator = new CriticCliCoordinator(
    activeCriticAgentSupervisor,
  );
  const activeModel =
    selectedModel ??
    selectModelAdapters(environment, {
      ...(environment.CRITIC_PROVIDER === "cli-agent"
        ? {
            criticOverride: {
              adapter: new CliCriticAdapter(
                activeCriticAgentBroker,
                criticCliCoordinator,
                (prompt) =>
                  activeCriticAgentSupervisor.wake
                    ? activeCriticAgentSupervisor.wake(prompt)
                    : Promise.reject(
                        new Error(
                          "The injected critic controller cannot wake a CLI.",
                        ),
                      ),
              ),
              model: `${environment.CRITIC_AGENT}-cli`,
              runtime: { state: "ready" as const },
            },
          }
        : {}),
    });
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
  const reconciliationQueue = new ReconciliationQueue(
    activeDatabase,
    activeModel,
    criticBroker,
    reconciliationIdleMs,
    server.log,
  );
  const criticQueue = new CriticQueue(
    activeDatabase,
    activeModel,
    criticBroker,
    server.log,
    (input) => {
      reconciliationQueue.enqueue(input);
    },
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
  registerDocumentRoutes(
    server,
    activeDatabase,
    reconciliationQueue,
    criticBroker,
  );
  registerCompletionRoutes(
    server,
    activeDatabase,
    activeModel,
    activeTrainingTraceWriter,
  );
  registerCriticRoutes(
    server,
    activeDatabase,
    criticQueue,
    reconciliationQueue,
    criticBroker,
  );
  registerCriticAgentRoutes(
    server,
    activeCriticAgentSupervisor,
    activeCriticAgentBroker,
    activeIssueChatAgentBroker,
    environment.CRITIC_PROVIDER === "cli-agent",
  );
  registerIssueChatRoutes(server, {
    database: activeDatabase,
    agentBroker: activeIssueChatAgentBroker,
    coordinator: criticCliCoordinator,
    controller: activeCriticAgentSupervisor,
    events: criticBroker,
    enabled: environment.CRITIC_PROVIDER === "cli-agent",
    provider: activeModel.critic.adapter.providerId,
    model: activeModel.critic.model,
  });
  registerCriticMcpRoute(
    server,
    activeCriticAgentBroker,
    activeIssueChatAgentBroker,
    activeMcpBearerToken,
  );

  server.addHook("onClose", async () => {
    reconciliationQueue.close();
    activeCriticAgentBroker.close();
    activeIssueChatAgentBroker.close();
    await activeTrainingTraceWriter.flush();
    await activeModel.completion.shutdown?.();
    if (ownsDatabase) {
      activeDatabase.sqlite.close();
    }
  });

  return server;
}
