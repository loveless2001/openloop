import type { FastifyInstance } from "fastify";

import {
  CriticAgentLaunchError,
  type CriticAgentController,
} from "../critic-agent-supervisor.js";
import type { CriticAgentBroker } from "../critic-agent-broker.js";
import type { IssueChatAgentBroker } from "../issue-chat-agent-broker.js";

export function registerCriticAgentRoutes(
  server: FastifyInstance,
  supervisor: CriticAgentController,
  broker: CriticAgentBroker,
  chatBroker: IssueChatAgentBroker,
  bridgeEnabled: boolean,
): void {
  const withBridgeStatus = async (
    process: Awaited<ReturnType<CriticAgentController["status"]>>,
  ) => {
    const criticJobs = broker.getStatus();
    const chatJobs = chatBroker.getStatus();
    const jobs = {
      pending: criticJobs.pending + chatJobs.pending,
      leased: criticJobs.leased + chatJobs.leased,
    };
    return {
      ...process,
      bridgeState: !bridgeEnabled
        ? ("inactive" as const)
        : jobs.leased > 0
          ? ("busy" as const)
          : jobs.pending > 0
            ? ("queued" as const)
            : ("idle" as const),
      pendingJobs: jobs.pending + jobs.leased,
    };
  };
  server.get("/v1/critic-agent/status", async () =>
    withBridgeStatus(await supervisor.status()),
  );
  server.post("/v1/critic-agent/launch", async (request, reply) => {
    try {
      return withBridgeStatus(await supervisor.launch());
    } catch (error) {
      if (error instanceof CriticAgentLaunchError) {
        return reply.code(503).send({
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
