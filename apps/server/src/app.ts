import Fastify from "fastify";
import {
  MockWritingEvaluator,
  TypeSafeWritingEvaluator,
  type WritingEvaluator,
} from "@openloop/model-adapters";

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
import { registerLocalDataRoutes } from "./routes/local-data.js";
import { registerWritingEvaluationRoutes } from "./routes/writing-evaluations.js";
import { registerWritingRubricRoutes } from "./routes/writing-rubrics.js";
import { TrainingTraceWriter } from "./training-traces.js";
import { registerCriticMcpRoute } from "./critic-mcp.js";
import { IssueChatAgentBroker } from "./issue-chat-agent-broker.js";
import {
  WritingEvaluationService,
  type EvaluatorConfiguration,
} from "./writing-evaluation-service.js";

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
  writingEvaluator?: WritingEvaluator;
}

function evaluatorConfiguration(
  environment: Environment,
): EvaluatorConfiguration {
  if (environment.EVALUATOR_PROVIDER === "mock") {
    return {
      providerId: "mock",
      requestedModel: "mock-writing-fixtures-v1",
      endpointIdentity: "mock://local",
      mode: "mock",
      configured: true,
      label: "Mock — UI test only",
      destination: "local process",
    };
  }
  const endpointIdentity = `${environment.JEV_API_BASE_URL.replace(/\/$/, "")}/systemone`;
  return {
    providerId: "typesafe",
    requestedModel: environment.JEV_MODEL,
    endpointIdentity,
    mode: environment.EVALUATOR_PROVIDER === "disabled" ? "disabled" : "remote",
    configured:
      environment.EVALUATOR_PROVIDER === "typesafe" &&
      Boolean(environment.TYPESAFE_API_KEY.trim()),
    label:
      environment.EVALUATOR_PROVIDER === "disabled"
        ? "Writing evaluation disabled"
        : "TypeSafe Jev — remote evaluation",
    destination: new URL(endpointIdentity).host,
  };
}

function defaultWritingEvaluator(
  environment: Environment,
): WritingEvaluator | undefined {
  if (environment.EVALUATOR_PROVIDER === "mock") {
    return new MockWritingEvaluator();
  }
  if (
    environment.EVALUATOR_PROVIDER === "typesafe" &&
    environment.TYPESAFE_API_KEY.trim()
  ) {
    return new TypeSafeWritingEvaluator({
      apiKey: environment.TYPESAFE_API_KEY,
      baseUrl: environment.JEV_API_BASE_URL,
      timeoutMs: environment.JEV_TIMEOUT_MS,
      allowInsecureLoopback:
        environment.NODE_ENV === "test" &&
        new URL(environment.JEV_API_BASE_URL).protocol === "http:",
    });
  }
  return undefined;
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
  writingEvaluator,
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
  if (environment.COMPLETION_ENABLED && activeModel.completion.warmup) {
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
  const evaluationConfiguration = evaluatorConfiguration(environment);
  const evaluationService = new WritingEvaluationService(
    activeDatabase,
    writingEvaluator ?? defaultWritingEvaluator(environment),
    evaluationConfiguration,
    server.log,
  );
  server.get("/v1/health", async () => ({ status: "ok" as const }));
  server.get("/v1/model-status", async () => {
    if (
      environment.COMPLETION_ENABLED &&
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
      state: environment.COMPLETION_ENABLED
        ? activeModel.completion.runtime.state
        : "disabled",
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
  registerWritingRubricRoutes(server, activeDatabase);
  registerWritingEvaluationRoutes(server, evaluationService);
  registerCompletionRoutes(
    server,
    activeDatabase,
    activeModel,
    activeTrainingTraceWriter,
    environment.COMPLETION_ENABLED,
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
  registerLocalDataRoutes(
    server,
    activeDatabase,
    activeTrainingTraceWriter,
    evaluationService,
  );
  registerCriticMcpRoute(
    server,
    activeCriticAgentBroker,
    activeIssueChatAgentBroker,
    activeMcpBearerToken,
  );

  server.addHook("onClose", async () => {
    evaluationService.close();
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
