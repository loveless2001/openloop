import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { buildServer } from "../src/app.js";
import { readEnvironment } from "../src/config/env.js";
import { CriticAgentBroker } from "../src/critic-agent-broker.js";
import { openDatabase, type Database } from "../src/db/client.js";

const tempDirectory = mkdtempSync(join(tmpdir(), "openloop-cli-critic-"));
const environment = readEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: `file:${join(tempDirectory, "test.db")}`,
  COMPLETION_PROVIDER: "mock",
  CRITIC_PROVIDER: "cli-agent",
  CRITIC_AGENT: "codex",
});
const broker = new CriticAgentBroker(30_000);
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
    criticAgentBroker: broker,
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

beforeEach(() => wake.mockClear());

describe("CLI critic integration", () => {
  it("routes a critic request through the broker and persists submitted issues", async () => {
    const nodeId = "24ed13e0-e0a8-4355-8f21-d8132558e008";
    const beforeId = "b3fd5d7a-4bed-4a08-867f-a5a4dd7677f5";
    const afterId = "fc7ae471-c597-4dd8-8204-4c79977c6d79";
    const text = "Any model will work equally well in every writing context.";
    const createdResponse = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "CLI critique",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: beforeId },
              content: [
                { type: "text", text: "This compares two local models." },
              ],
            },
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text }],
            },
            {
              type: "paragraph",
              attrs: { nodeId: afterId },
              content: [
                { type: "text", text: "Latency is measured separately." },
              ],
            },
          ],
        },
      },
    });
    const documentId = createdResponse.json().id as string;
    const queued = await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId: "b2c099ea-47cf-4ee7-829d-61a5bccf5fdb",
        documentVersion: 0,
        trigger: "manual",
        scope: { kind: "changes" },
        changedBlocks: [
          { nodeId, nodeType: "paragraph", text, headingPath: [] },
        ],
      },
    });
    expect(queued.statusCode).toBe(202);
    await vi.waitFor(() => expect(wake).toHaveBeenCalledOnce());

    const queuedStatus = await server.inject({
      method: "GET",
      url: "/v1/critic-agent/status",
    });
    expect(queuedStatus.json()).toMatchObject({
      bridgeState: "queued",
      pendingJobs: 1,
    });

    const claim = broker.claim();
    expect(claim?.job.openIssues).toEqual([]);
    await expect(
      broker.requestContext(claim!.jobId, claim!.leaseToken, {
        beforeBlocks: 1,
        afterBlocks: 1,
      }),
    ).resolves.toMatchObject({
      beforeBlocks: [
        { nodeId: beforeId, text: "This compares two local models." },
      ],
      afterBlocks: [
        { nodeId: afterId, text: "Latency is measured separately." },
      ],
    });
    const busyStatus = await server.inject({
      method: "GET",
      url: "/v1/critic-agent/status",
    });
    expect(busyStatus.json()).toMatchObject({
      bridgeState: "busy",
      pendingJobs: 1,
    });
    broker.submit(claim!.jobId, claim!.leaseToken, [
      {
        type: "unsupported_claim",
        anchorQuote: "Any model will work equally well",
        question: "What evidence supports equivalent behavior across models?",
        rationale:
          "Interface compatibility does not establish equal output quality.",
        severity: 4,
        confidence: 0.95,
        interruptWorthiness: 0.9,
        resurfaceTriggers: ["claim_reused"],
        keywords: ["model", "equally well"],
      },
    ]);

    await vi.waitFor(async () => {
      const response = await server.inject({
        method: "GET",
        url: `/v1/documents/${documentId}/issues`,
      });
      expect(response.json().issues).toHaveLength(1);
    });
    const issues = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}/issues`,
    });
    expect(issues.json().issues[0]).toMatchObject({
      type: "unsupported_claim",
      anchor: { quote: "Any model will work equally well" },
    });
    const idleStatus = await server.inject({
      method: "GET",
      url: "/v1/critic-agent/status",
    });
    expect(idleStatus.json()).toMatchObject({
      bridgeState: "idle",
      pendingJobs: 0,
    });

    await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId: "13b14ccc-e6d9-4a86-9e0c-e0401ee11e52",
        documentVersion: 0,
        trigger: "manual",
        scope: { kind: "changes" },
        changedBlocks: [
          { nodeId, nodeType: "paragraph", text, headingPath: [] },
        ],
      },
    });
    await vi.waitFor(() => expect(wake).toHaveBeenCalledTimes(2));
    const followUp = broker.claim();
    expect(followUp?.job.openIssues).toEqual([
      expect.objectContaining({
        type: "unsupported_claim",
        anchorQuote: "Any model will work equally well",
        status: "open",
      }),
    ]);
    broker.submit(followUp!.jobId, followUp!.leaseToken, []);
    await vi.waitFor(() => {
      const run = database.sqlite
        .prepare("select status from model_runs where request_id = ?")
        .get("13b14ccc-e6d9-4a86-9e0c-e0401ee11e52") as
        { status: string } | undefined;
      expect(run?.status).toBe("completed");
    });
  });

  it("rejects a leased result after the canonical document version changes", async () => {
    const nodeId = "81ae1bc9-0b42-41ab-96e7-1d0043354449";
    const original =
      "This claim has enough text for a delayed critic response.";
    const createdResponse = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Stale CLI critique",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: original }],
            },
          ],
        },
      },
    });
    const documentId = createdResponse.json().id as string;
    const requestId = "71c3206c-ea69-4f6c-ab75-55b7d44e1277";
    await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId,
        documentVersion: 0,
        trigger: "manual",
        scope: { kind: "changes" },
        changedBlocks: [
          { nodeId, nodeType: "paragraph", text: original, headingPath: [] },
        ],
      },
    });
    await vi.waitFor(() => expect(wake).toHaveBeenCalledOnce());
    const claim = broker.claim();

    const revised = `${original} Revised.`;
    const saved = await server.inject({
      method: "PUT",
      url: `/v1/documents/${documentId}`,
      payload: {
        documentId,
        baseVersion: 0,
        title: "Stale CLI critique",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: revised }],
            },
          ],
        },
        plainText: revised,
        changeBatch: {
          documentId,
          baseVersion: 0,
          clientSequence: 1,
          changedBlocks: [
            {
              nodeId,
              nodeType: "paragraph",
              text: revised,
              previousText: original,
              headingPath: [],
            },
          ],
          removedNodeIds: [],
          mergedNodeMap: {},
          reason: "typing",
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    broker.submit(claim!.jobId, claim!.leaseToken, []);

    await vi.waitFor(() => {
      const run = database.sqlite
        .prepare(
          "select status, error_code as errorCode from model_runs where request_id = ?",
        )
        .get(requestId) as { status: string; errorCode: string } | undefined;
      expect(run).toEqual({ status: "aborted", errorCode: "MODEL_ABORTED" });
    });
    const issues = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}/issues`,
    });
    expect(issues.json().issues).toEqual([]);
  });
});
