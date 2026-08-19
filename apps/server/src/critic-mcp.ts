import {
  createMcpHandler,
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  CriticScopeSchema,
  IssueAnchorSchema,
  IssueCandidateSchema,
  IssueChatMessageSchema,
  IssueChatReplySchema,
  IssueStatus,
  IssueType,
  TextBlockSnapshotSchema,
} from "@openloop/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  CriticAgentBrokerError,
  type CriticAgentBroker,
} from "./critic-agent-broker.js";
import {
  IssueChatAgentBrokerError,
  type IssueChatAgentBroker,
} from "./issue-chat-agent-broker.js";

const OpenIssueSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  question: z.string().min(1),
  anchorQuote: z.string(),
  status: z.string().min(1),
});

const CriticInputSchema = z.object({
  requestId: z.uuid(),
  documentTitle: z.string(),
  documentVersion: z.number().int().nonnegative(),
  scope: CriticScopeSchema,
  changedBlocks: z.array(TextBlockSnapshotSchema).max(250),
  contextPolicy: z.object({
    canRequestMore: z.boolean(),
    maxRequests: z.number().int().nonnegative(),
    maxBlocksPerSide: z.number().int().nonnegative(),
  }),
  openIssues: z.array(OpenIssueSchema),
});

const ClaimOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({
    status: z.literal("claimed"),
    jobId: z.uuid(),
    leaseToken: z.string().length(64),
    leaseExpiresAt: z.iso.datetime(),
    job: CriticInputSchema,
  }),
]);

const AcknowledgementSchema = z.object({
  accepted: z.literal(true),
  jobId: z.uuid(),
  hasPending: z.boolean(),
});

const ContextOutputSchema = z.object({
  beforeBlocks: z.array(TextBlockSnapshotSchema),
  afterBlocks: z.array(TextBlockSnapshotSchema),
});

const FailureCodeSchema = z.enum([
  "MODEL_TIMEOUT",
  "MODEL_ABORTED",
  "MODEL_RATE_LIMITED",
  "MODEL_MALFORMED_OUTPUT",
  "MODEL_UNAVAILABLE",
]);

const IssueChatInputSchema = z.object({
  requestId: z.uuid(),
  documentTitle: z.string(),
  documentVersion: z.number().int().nonnegative(),
  issue: z.object({
    id: z.uuid(),
    type: IssueType,
    status: IssueStatus,
    question: z.string(),
    rationale: z.string(),
    suggestedRewrite: z.string().optional(),
    severity: z.number().int().min(1).max(5),
    anchor: IssueAnchorSchema,
  }),
  messages: z.array(IssueChatMessageSchema).max(21),
});

const IssueChatClaimOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({
    status: z.literal("claimed"),
    jobId: z.uuid(),
    leaseToken: z.string().length(64),
    leaseExpiresAt: z.iso.datetime(),
    job: IssueChatInputSchema,
  }),
]);

function result(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function toolError(error: unknown): CallToolResult {
  const message =
    error instanceof Error ? error.message : "Critic bridge failed.";
  const code =
    error instanceof CriticAgentBrokerError
      ? error.code
      : error instanceof IssueChatAgentBrokerError
        ? error.code
        : "CRITIC_BRIDGE_ERROR";
  return {
    isError: true,
    content: [{ type: "text", text: `${code}: ${message}` }],
  };
}

export function createCriticMcpServer(
  broker: CriticAgentBroker,
  chatBroker: IssueChatAgentBroker,
): McpServer {
  const server = new McpServer(
    { name: "openloop-critic", version: "0.1.0" },
    {
      instructions:
        "You are OpenLoop's critic worker. OpenLoop will explicitly tell you whether to claim a document critique or an issue-chat turn. For a document critique, call openloop_critic_next, use only its changedBlocks and relevant openIssues, request bounded context only when necessary, and finish with openloop_critic_submit or openloop_critic_fail. For an issue-chat turn, call openloop_issue_chat_next, answer the user's latest message in light of the bounded thread and attachments, and finish with openloop_issue_chat_submit or openloop_issue_chat_fail. Use kind=clarification when more user context is genuinely needed. Never edit the document or issue ledger, never change issue status, never claim a second job in the same turn, and never poll after an idle result.",
    },
  );

  server.registerTool(
    "openloop_critic_context",
    {
      title: "Request neighboring context",
      description:
        "Fetch a bounded number of document blocks immediately before and after the focused text when that context is necessary to critique it accurately.",
      inputSchema: z.object({
        jobId: z.uuid(),
        leaseToken: z.string().length(64),
        beforeBlocks: z.number().int().min(0).max(6),
        afterBlocks: z.number().int().min(0).max(6),
      }),
      outputSchema: ContextOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ jobId, leaseToken, beforeBlocks, afterBlocks }) => {
      try {
        return result({
          ...(await broker.requestContext(jobId, leaseToken, {
            beforeBlocks,
            afterBlocks,
          })),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "openloop_issue_chat_next",
    {
      title: "Claim the current OpenLoop issue-chat turn",
      description:
        "Claim one pending user message for the active issue chat. Call once when OpenLoop wakes you; do not poll.",
      inputSchema: z.object({}),
      outputSchema: IssueChatClaimOutputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async () => {
      const claim = chatBroker.claim();
      return result(
        claim ? { status: "claimed", ...claim } : { status: "idle" },
      );
    },
  );

  server.registerTool(
    "openloop_issue_chat_submit",
    {
      title: "Submit an OpenLoop issue-chat reply",
      description:
        "Complete the claimed issue-chat turn with a direct reply or a clarification request.",
      inputSchema: z.object({
        jobId: z.uuid(),
        leaseToken: z.string().length(64),
        reply: IssueChatReplySchema,
      }),
      outputSchema: z.object({
        accepted: z.literal(true),
        jobId: z.uuid(),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ jobId, leaseToken, reply }) => {
      try {
        chatBroker.submit(jobId, leaseToken, reply);
        return result({ accepted: true, jobId });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "openloop_issue_chat_fail",
    {
      title: "Fail an OpenLoop issue-chat turn",
      description:
        "Release a claimed issue-chat turn when the critic cannot respond.",
      inputSchema: z.object({
        jobId: z.uuid(),
        leaseToken: z.string().length(64),
        message: z.string().min(1).max(500),
      }),
      outputSchema: z.object({
        accepted: z.literal(true),
        jobId: z.uuid(),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ jobId, leaseToken, message }) => {
      try {
        chatBroker.fail(jobId, leaseToken, message);
        return result({ accepted: true, jobId });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "openloop_critic_next",
    {
      title: "Claim next OpenLoop critic job",
      description:
        "Claim one pending critic job. Call once when OpenLoop wakes you; do not poll.",
      inputSchema: z.object({}),
      outputSchema: ClaimOutputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async () => {
      const claim = broker.claim();
      return result(
        claim ? { status: "claimed", ...claim } : { status: "idle" },
      );
    },
  );

  server.registerTool(
    "openloop_critic_submit",
    {
      title: "Submit OpenLoop critic results",
      description:
        "Complete a claimed critic job with zero to three structured issue candidates.",
      inputSchema: z.object({
        jobId: z.uuid(),
        leaseToken: z.string().length(64),
        candidates: z.array(IssueCandidateSchema).max(3),
      }),
      outputSchema: AcknowledgementSchema,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ jobId, leaseToken, candidates }) => {
      try {
        const hasPending = broker.submit(jobId, leaseToken, candidates);
        return result({ accepted: true, jobId, hasPending });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "openloop_critic_fail",
    {
      title: "Fail an OpenLoop critic job",
      description:
        "Release a claimed job when criticism cannot be completed. Use only for an actual failure.",
      inputSchema: z.object({
        jobId: z.uuid(),
        leaseToken: z.string().length(64),
        code: FailureCodeSchema,
        message: z.string().min(1).max(500),
      }),
      outputSchema: AcknowledgementSchema,
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ jobId, leaseToken, code, message }) => {
      try {
        const hasPending = broker.fail(jobId, leaseToken, code, message);
        return result({ accepted: true, jobId, hasPending });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

export function registerCriticMcpRoute(
  server: FastifyInstance,
  broker: CriticAgentBroker,
  chatBroker: IssueChatAgentBroker,
  bearerToken: string,
): void {
  const handler = createMcpHandler(
    () => createCriticMcpServer(broker, chatBroker),
    {
      legacy: "stateless",
      onerror: (error) => server.log.error({ err: error }, "Critic MCP failed"),
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) =>
      server.log.error({ err: error }, "Critic MCP transport failed"),
  });
  const validateHost = localhostHostValidation();

  server.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      if (request.headers.authorization !== `Bearer ${bearerToken}`) {
        return reply
          .code(401)
          .header("www-authenticate", "Bearer")
          .send({ error: "Unauthorized" });
      }
      reply.hijack();
      if (!validateHost(request.raw, reply.raw)) return;
      await nodeHandler(request.raw, reply.raw, request.body);
    },
  });

  server.addHook("onClose", async () => handler.close());
}
