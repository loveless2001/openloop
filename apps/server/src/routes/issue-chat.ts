import {
  IssueChatSendRequestSchema,
  type IssueChatSendRequest,
} from "@openloop/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { CriticAgentController } from "../critic-agent-supervisor.js";
import type { CriticCliCoordinator } from "../critic-cli-coordinator.js";
import type { CriticEventBroker } from "../critic-events.js";
import type { Database } from "../db/client.js";
import { getDocument } from "../documents.js";
import type { IssueChatAgentBroker } from "../issue-chat-agent-broker.js";
import { processIssueChatTurn } from "../issue-chat-service.js";
import {
  appendUserIssueChatMessage,
  ensureIssueChatThread,
  getIssueChat,
  IssueChatBusyError,
} from "../issue-chat.js";
import { getIssue, IssueNotFoundError } from "../issues.js";

const IssueParamsSchema = z.object({ issueId: z.uuid() });

function apiError(
  reply: FastifyReply,
  requestId: string,
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.code(statusCode).send({
    error: { code, message, requestId },
  });
}

export function registerIssueChatRoutes(
  server: FastifyInstance,
  input: {
    database: Database;
    agentBroker: IssueChatAgentBroker;
    coordinator: CriticCliCoordinator;
    controller: CriticAgentController;
    events: CriticEventBroker;
    enabled: boolean;
    provider: string;
    model: string;
  },
): void {
  server.get("/v1/issues/:issueId/chat", async (request, reply) => {
    try {
      const { issueId } = IssueParamsSchema.parse(request.params);
      return getIssueChat(input.database, issueId);
    } catch (error) {
      if (error instanceof IssueNotFoundError) {
        return apiError(reply, request.id, 404, error.code, error.message);
      }
      throw error;
    }
  });

  server.post("/v1/issues/:issueId/chat/activate", async (request, reply) => {
    try {
      const { issueId } = IssueParamsSchema.parse(request.params);
      const thread = ensureIssueChatThread(input.database, issueId);
      if (!input.enabled) {
        return apiError(
          reply,
          request.id,
          409,
          "ISSUE_CHAT_UNAVAILABLE",
          "Issue chat currently requires the CLI critic provider.",
        );
      }
      void input.coordinator.activateIssue(issueId).catch((error: unknown) => {
        const issue = getIssue(input.database, issueId);
        input.events.emit(issue.documentId, {
          event: "critic_error",
          data: {
            code: "MODEL_UNAVAILABLE",
            message:
              error instanceof Error
                ? error.message
                : "The critic CLI could not start a new chat.",
            jobId: request.id,
          },
        });
      });
      return {
        thread,
        messages: getIssueChat(input.database, issueId).messages,
      };
    } catch (error) {
      if (error instanceof IssueNotFoundError) {
        return apiError(reply, request.id, 404, error.code, error.message);
      }
      throw error;
    }
  });

  server.post("/v1/issues/:issueId/chat/messages", async (request, reply) => {
    try {
      const { issueId } = IssueParamsSchema.parse(request.params);
      if (!input.enabled) {
        return apiError(
          reply,
          request.id,
          409,
          "ISSUE_CHAT_UNAVAILABLE",
          "Issue chat currently requires the CLI critic provider.",
        );
      }
      const body: IssueChatSendRequest = IssueChatSendRequestSchema.parse(
        request.body,
      );
      const issue = getIssue(input.database, issueId);
      const document = getDocument(input.database, issue.documentId);
      if (document.version !== body.documentVersion) {
        return apiError(
          reply,
          request.id,
          409,
          "DOCUMENT_VERSION_CONFLICT",
          "The document changed before the chat message was sent.",
        );
      }
      const persisted = appendUserIssueChatMessage(
        input.database,
        issueId,
        body,
      );
      input.events.emit(issue.documentId, {
        event: "issue_chat_updated",
        data: {
          issueId,
          thread: persisted.thread,
          message: persisted.message,
        },
      });
      processIssueChatTurn({
        database: input.database,
        broker: input.agentBroker,
        coordinator: input.coordinator,
        controller: input.controller,
        events: input.events,
        issueId,
        request: body,
        provider: input.provider,
        model: input.model,
      });
      return reply.code(202).send(persisted);
    } catch (error) {
      if (error instanceof IssueNotFoundError) {
        return apiError(reply, request.id, 404, error.code, error.message);
      }
      if (error instanceof IssueChatBusyError) {
        return apiError(reply, request.id, 409, error.code, error.message);
      }
      throw error;
    }
  });
}
