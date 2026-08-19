import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildServer } from "../src/app.js";
import { readEnvironment } from "../src/config/env.js";
import { openDatabase, type Database } from "../src/db/client.js";
import { issues } from "../src/db/schema.js";
import { IssueChatAgentBroker } from "../src/issue-chat-agent-broker.js";

const tempDirectory = mkdtempSync(join(tmpdir(), "openloop-issue-chat-"));
const environment = readEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: `file:${join(tempDirectory, "test.db")}`,
  COMPLETION_PROVIDER: "mock",
  CRITIC_PROVIDER: "cli-agent",
  CRITIC_AGENT: "codex",
});
const chatBroker = new IssueChatAgentBroker(30_000);
const wake = vi.fn(async () => undefined);
const supervisor = {
  status: vi.fn(async () => ({
    state: "running" as const,
    agent: "codex" as const,
    sessionName: "openloop-critic" as const,
    attachCommand: "tmux attach -t openloop-critic" as const,
    message: "codex is running in openloop-critic.",
  })),
  launch: vi.fn(),
  wake,
};
let database: Database;
let server: ReturnType<typeof buildServer>;

beforeAll(async () => {
  database = openDatabase(environment.DATABASE_URL);
  server = buildServer({
    environment,
    database,
    logger: false,
    issueChatAgentBroker: chatBroker,
    criticAgentSupervisor: supervisor,
    mcpBearerToken: "test-token",
  });
  await server.ready();
});

afterAll(async () => {
  await server.close();
  database.sqlite.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("issue chat integration", () => {
  it("clears on first activation, persists a bounded turn, and reuses the same active issue", async () => {
    const nodeId = "24ed13e0-e0a8-4355-8f21-d8132558e008";
    const issueId = "ab9adf5e-03a8-4c8b-a15c-779478f9b228";
    const text = "The conclusion follows from every available example.";
    const created = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Issue chat",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text }],
            },
          ],
        },
      },
    });
    const documentId = created.json().id as string;
    const now = Date.now();
    database.orm
      .insert(issues)
      .values({
        id: issueId,
        documentId,
        type: "evidence_gap",
        status: "open",
        question: "Which evidence supports this conclusion?",
        rationale: "Examples alone may not establish the general claim.",
        severity: 4,
        confidence: 0.9,
        interruptWorthiness: 0.9,
        anchorJson: JSON.stringify({
          nodeId,
          quote: "every available example",
          quoteStart: 28,
          quoteEnd: 51,
          leftContext: "The conclusion follows from ",
          rightContext: ".",
          normalizedFingerprint: "0".repeat(64),
          sourceDocumentVersion: 0,
          detached: false,
        }),
        keywordsJson: JSON.stringify(["evidence", "example"]),
        resurfaceTriggersJson: JSON.stringify(["claim_reused"]),
        dedupeKey: "1".repeat(64),
        shownCount: 1,
        silentIgnoreCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const activated = await server.inject({
      method: "POST",
      url: `/v1/issues/${issueId}/chat/activate`,
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json()).toMatchObject({
      thread: { issueId, state: "idle" },
      messages: [],
    });
    await vi.waitFor(() => expect(wake).toHaveBeenCalledWith("/clear"));

    await server.inject({
      method: "POST",
      url: `/v1/issues/${issueId}/chat/activate`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      wake.mock.calls.filter(([prompt]) => prompt === "/clear"),
    ).toHaveLength(1);

    const sent = await server.inject({
      method: "POST",
      url: `/v1/issues/${issueId}/chat/messages`,
      payload: {
        requestId: "aa1eb52b-f96c-4faa-8587-43411319fec4",
        documentVersion: 0,
        content: "Does the next paragraph address it?",
        attachments: [
          {
            source: "user",
            text: "every available example",
            wordCount: 3,
            blocks: [
              {
                nodeId,
                nodeType: "paragraph",
                text: "every available example",
                headingPath: [],
                selectionStart: 28,
                selectionEnd: 51,
              },
            ],
          },
        ],
      },
    });
    expect(sent.statusCode).toBe(202);
    expect(sent.json()).toMatchObject({
      thread: { state: "waiting_on_critic" },
      message: { role: "user" },
    });

    await vi.waitFor(() =>
      expect(chatBroker.getStatus()).toEqual({ pending: 1, leased: 0 }),
    );
    const claim = chatBroker.claim();
    expect(claim?.job).toMatchObject({
      issue: { id: issueId, status: "open" },
      messages: [
        {
          role: "user",
          attachments: [{ text: "every available example" }],
        },
      ],
    });
    chatBroker.submit(claim!.jobId, claim!.leaseToken, {
      kind: "clarification",
      content: "Please attach the next paragraph so I can compare it.",
    });

    await vi.waitFor(async () => {
      const chat = await server.inject({
        method: "GET",
        url: `/v1/issues/${issueId}/chat`,
      });
      expect(chat.json()).toMatchObject({
        thread: { state: "waiting_on_user" },
        messages: [
          { role: "user", kind: "message" },
          { role: "critic", kind: "clarification" },
        ],
      });
    });
  });
});
