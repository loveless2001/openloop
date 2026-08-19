import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CriticAgentBroker } from "./critic-agent-broker.js";
import { registerCriticMcpRoute } from "./critic-mcp.js";
import { IssueChatAgentBroker } from "./issue-chat-agent-broker.js";

const token = "test-token";
let broker: CriticAgentBroker;
let chatBroker: IssueChatAgentBroker;
let server: ReturnType<typeof Fastify>;

function payload(body: string): Record<string, unknown> {
  if (body.trimStart().startsWith("{")) return JSON.parse(body);
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .at(-1)
    ?.slice(5)
    .trim();
  if (!data) throw new Error(`No MCP payload in response: ${body}`);
  return JSON.parse(data);
}

beforeEach(async () => {
  broker = new CriticAgentBroker(30_000);
  chatBroker = new IssueChatAgentBroker(30_000);
  server = Fastify({ logger: false });
  registerCriticMcpRoute(server, broker, chatBroker, token);
  await server.ready();
});

afterEach(async () => server.close());

describe("critic MCP bridge", () => {
  it("requires the per-process bearer token", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(response.statusCode).toBe(401);

    const rebound = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${token}`,
        host: "attacker.example",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "ping" },
    });
    expect(rebound.statusCode).toBe(403);
  });

  it("claims a bounded job and resolves it through structured submission", async () => {
    const pending = broker.enqueue(
      {
        requestId: "b2c099ea-47cf-4ee7-829d-61a5bccf5fdb",
        documentTitle: "Argument",
        documentVersion: 2,
        scope: { kind: "changes" },
        changedBlocks: [
          {
            nodeId: "24ed13e0-e0a8-4355-8f21-d8132558e008",
            nodeType: "paragraph",
            text: "Any model will work equally well.",
            headingPath: [],
          },
        ],
        contextPolicy: {
          canRequestMore: true,
          maxRequests: 2,
          maxBlocksPerSide: 6,
        },
        openIssues: [],
      },
      new AbortController().signal,
      async () => ({
        beforeBlocks: [
          {
            nodeId: "81ae1bc9-0b42-41ab-96e7-1d0043354449",
            nodeType: "paragraph",
            text: "The comparison is limited to one benchmark.",
            headingPath: [],
          },
        ],
        afterBlocks: [],
      }),
    );
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    };
    const claimedResponse = await server.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "openloop_critic_next", arguments: {} },
      },
    });
    expect(claimedResponse.statusCode).toBe(200);
    const claimed = payload(claimedResponse.body).result as {
      structuredContent: {
        jobId: string;
        leaseToken: string;
        status: string;
        job: { openIssues: unknown[] };
      };
    };
    expect(claimed.structuredContent).toMatchObject({
      status: "claimed",
      jobId: pending.jobId,
      job: { openIssues: [] },
    });

    const contextResponse = await server.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "openloop_critic_context",
          arguments: {
            jobId: claimed.structuredContent.jobId,
            leaseToken: claimed.structuredContent.leaseToken,
            beforeBlocks: 1,
            afterBlocks: 0,
          },
        },
      },
    });
    expect(payload(contextResponse.body)).toMatchObject({
      result: {
        structuredContent: {
          beforeBlocks: [
            { text: "The comparison is limited to one benchmark." },
          ],
          afterBlocks: [],
        },
      },
    });

    const submittedResponse = await server.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "openloop_critic_submit",
          arguments: {
            jobId: claimed.structuredContent.jobId,
            leaseToken: claimed.structuredContent.leaseToken,
            candidates: [],
          },
        },
      },
    });
    expect(submittedResponse.statusCode).toBe(200);
    expect(payload(submittedResponse.body)).toMatchObject({
      result: {
        structuredContent: {
          accepted: true,
          jobId: pending.jobId,
          hasPending: false,
        },
      },
    });
    await expect(pending.result).resolves.toEqual([]);
  });

  it("claims and submits a structured issue-chat reply", async () => {
    const issueId = "ab9adf5e-03a8-4c8b-a15c-779478f9b228";
    const pending = chatBroker.enqueue({
      requestId: "aa1eb52b-f96c-4faa-8587-43411319fec4",
      documentTitle: "Argument",
      documentVersion: 2,
      issue: {
        id: issueId,
        type: "evidence_gap",
        status: "open",
        question: "Which evidence supports this conclusion?",
        rationale: "The current examples may not establish the general claim.",
        severity: 4,
        anchor: {
          nodeId: "24ed13e0-e0a8-4355-8f21-d8132558e008",
          quote: "every available example",
          leftContext: "",
          rightContext: "",
          normalizedFingerprint: "0".repeat(64),
          sourceDocumentVersion: 2,
          detached: false,
        },
      },
      messages: [
        {
          id: "03a29e1d-8baa-4056-8878-78b2f5371e22",
          issueId,
          role: "user",
          kind: "message",
          content: "What evidence would resolve this?",
          attachments: [],
          createdAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    };
    const claimedResponse = await server.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "openloop_issue_chat_next", arguments: {} },
      },
    });
    const claimed = payload(claimedResponse.body).result as {
      structuredContent: {
        jobId: string;
        leaseToken: string;
        job: { issue: { id: string } };
      };
    };
    expect(claimed.structuredContent.job.issue.id).toBe(issueId);

    const submittedResponse = await server.inject({
      method: "POST",
      url: "/mcp",
      headers,
      payload: {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "openloop_issue_chat_submit",
          arguments: {
            jobId: claimed.structuredContent.jobId,
            leaseToken: claimed.structuredContent.leaseToken,
            reply: {
              kind: "clarification",
              content: "Please attach the evidence paragraph.",
            },
          },
        },
      },
    });
    expect(submittedResponse.statusCode).toBe(200);
    await expect(pending.result).resolves.toEqual({
      kind: "clarification",
      content: "Please attach the evidence paragraph.",
    });
  });
});
