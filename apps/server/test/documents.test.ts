import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildServer } from "../src/app.js";
import { readEnvironment } from "../src/config/env.js";
import { openDatabase, type Database } from "../src/db/client.js";

const tempDirectory = mkdtempSync(join(tmpdir(), "openloop-server-"));
const environment = readEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: `file:${join(tempDirectory, "test.db")}`,
  COMPLETION_PROVIDER: "mock",
  COMPLETION_ENABLED: "true",
  CRITIC_PROVIDER: "mock",
  CAPTURE_TRAINING_TRACES: "true",
  TRAINING_TRACE_PATH: join(tempDirectory, "completion-traces.jsonl"),
});
let database: Database;
let server: ReturnType<typeof buildServer>;
const criticAgentSupervisor = {
  status: vi.fn(async () => ({
    state: "stopped" as const,
    agent: "codex" as const,
    sessionName: "openloop-critic" as const,
    attachCommand: "tmux attach -t openloop-critic" as const,
    message: "codex is ready to launch in tmux.",
  })),
  launch: vi.fn(async () => ({
    state: "running" as const,
    agent: "codex" as const,
    sessionName: "openloop-critic" as const,
    attachCommand: "tmux attach -t openloop-critic" as const,
    message: "codex is running in openloop-critic.",
  })),
};

beforeAll(async () => {
  database = openDatabase(environment.DATABASE_URL);
  server = buildServer({
    environment,
    database,
    logger: false,
    criticAgentSupervisor,
    mcpBearerToken: "test-token",
    reconciliationIdleMs: 0,
  });
  await server.ready();
});

afterAll(async () => {
  await server.close();
  database.sqlite.close();
  rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Phase 0/1 server", () => {
  it("reports a healthy API and creates every baseline table", async () => {
    const response = await server.inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    const modelStatus = await server.inject({
      method: "GET",
      url: "/v1/model-status",
    });
    expect(modelStatus.json()).toEqual({
      provider: "mock",
      completionModel: "mock-fast-v1",
      criticProvider: "mock",
      criticModel: "mock-smart-v1",
      mode: "offline",
      state: "ready",
    });

    const criticAgentStatus = await server.inject({
      method: "GET",
      url: "/v1/critic-agent/status",
    });
    expect(criticAgentStatus.json()).toMatchObject({
      state: "stopped",
      agent: "codex",
      sessionName: "openloop-critic",
      bridgeState: "inactive",
      pendingJobs: 0,
    });
    const launchedCriticAgent = await server.inject({
      method: "POST",
      url: "/v1/critic-agent/launch",
    });
    expect(launchedCriticAgent.json()).toMatchObject({
      state: "running",
      attachCommand: "tmux attach -t openloop-critic",
      bridgeState: "inactive",
    });

    const tables = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name in ('documents', 'document_events', 'issues', 'issue_events', 'issue_chat_threads', 'issue_chat_messages', 'model_runs', 'preference_weights', 'writing_evaluation_runs', 'writing_rubrics') order by name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual([
      "document_events",
      "documents",
      "issue_chat_messages",
      "issue_chat_threads",
      "issue_events",
      "issues",
      "model_runs",
      "preference_weights",
      "writing_evaluation_runs",
      "writing_rubrics",
    ]);

    const indexes = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'index' and name not like 'sqlite_autoindex%' order by name",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map(({ name }) => name)).toEqual([
      "document_events_document_created_idx",
      "issue_chat_messages_issue_created_idx",
      "issue_chat_threads_document_updated_idx",
      "issue_events_document_created_idx",
      "issue_events_issue_created_idx",
      "issues_document_dedupe_idx",
      "issues_document_status_idx",
      "issues_document_updated_idx",
      "writing_evaluation_runs_document_created_idx",
      "writing_evaluation_runs_request_id_idx",
    ]);
  });

  it("streams mock completion SSE without persisting document content to the database", async () => {
    const nodeId = "1a5dafdd-b267-4d78-85e9-810b1d56c5cd";
    const createdResponse = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Completion note",
        contentJson: {
          type: "doc",
          content: [{ type: "paragraph", attrs: { nodeId } }],
        },
      },
    });
    const created = createdResponse.json();
    const prefix = "The whole product is model agnostic";
    const prefixHash = createHash("sha256").update(prefix).digest("hex");

    const completionResponse = await server.inject({
      method: "POST",
      url: "/v1/completions/stream",
      payload: {
        requestId: "bb9952cf-f25d-42a1-a6b2-5a8f6a5c7b92",
        documentId: created.id,
        documentVersion: 0,
        nodeId,
        cursorOffset: prefix.length,
        prefix,
        suffix: "",
        headingPath: [],
        prefixHash,
      },
    });

    expect(completionResponse.statusCode).toBe(200);
    expect(completionResponse.headers["content-type"]).toContain(
      "text/event-stream",
    );
    expect(completionResponse.body).toContain("event: delta");
    expect(completionResponse.body).toContain("because interface");
    expect(completionResponse.body).toContain("compatibility does");
    expect(completionResponse.body).toContain("event: done");

    const loaded = await server.inject({
      method: "GET",
      url: `/v1/documents/${created.id}`,
    });
    expect(loaded.json().document).toMatchObject({ version: 0, plainText: "" });

    const run = database.sqlite
      .prepare(
        "select status, provider, model, input_hash as inputHash, error_code as errorCode from model_runs where request_id = ?",
      )
      .get("bb9952cf-f25d-42a1-a6b2-5a8f6a5c7b92") as {
      status: string;
      provider: string;
      model: string;
      inputHash: string;
      errorCode: string | null;
    };
    expect(run).toMatchObject({
      status: "completed",
      provider: "mock",
      model: "mock-fast-v1",
      errorCode: null,
    });
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.inputHash).not.toContain(prefix);
  });

  it("rejects a mismatched prefix hash and accepts metadata-only interaction events", async () => {
    const createdResponse = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Completion validation",
        contentJson: { type: "doc", content: [] },
      },
    });
    const documentId = createdResponse.json().id;
    const requestId = "6701a052-9ed1-48bf-ab76-a1b379daee3e";
    const nodeId = "97326b15-bab1-45fa-b5d3-65a4427a16dd";
    const invalid = await server.inject({
      method: "POST",
      url: "/v1/completions/stream",
      payload: {
        requestId,
        documentId,
        documentVersion: 0,
        nodeId,
        cursorOffset: 3,
        prefix: "abc",
        suffix: "",
        headingPath: [],
        prefixHash: "0".repeat(64),
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const event = await server.inject({
      method: "POST",
      url: "/v1/completion-events",
      payload: {
        requestId,
        documentId,
        documentVersion: 0,
        nodeId,
        event: "completion_dismissed",
      },
    });
    expect(event.statusCode).toBe(202);
    expect(event.json()).toEqual({ accepted: true });

    const traces = readFileSync(environment.TRAINING_TRACE_PATH, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "completion_candidate",
          requestId: "bb9952cf-f25d-42a1-a6b2-5a8f6a5c7b92",
          prefix: "The whole product is model agnostic",
        }),
        expect.objectContaining({
          type: "completion_feedback",
          requestId,
          event: "completion_dismissed",
        }),
      ]),
    );
  });

  it("allows local and mock providers without keys and rejects incomplete OpenAI configuration", () => {
    expect(environment.COMPLETION_PROVIDER).toBe("mock");
    expect(readEnvironment({}).COMPLETION_PROVIDER).toBe("ollama");
    expect(() =>
      readEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: "file:./data/openloop.db",
        CRITIC_PROVIDER: "openai",
        CRITIC_API_KEY: "",
      }),
    ).toThrow();
  });

  it("creates one anchored critic issue, deduplicates it, and persists actions", async () => {
    const nodeId = "56fa8f60-d0d3-42cd-b6bf-3602f004486f";
    const text =
      "The whole product is model agnostic, so any model will work equally well.";
    const createdResponse = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Critic note",
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
    const documentId = createdResponse.json().id as string;
    const changedBlocks = [
      {
        nodeId,
        nodeType: "paragraph",
        text,
        previousText: "",
        headingPath: [],
      },
    ];

    const firstJob = await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId: "ac962121-27c0-433d-b82e-f1600307698a",
        documentVersion: 0,
        trigger: "idle",
        scope: { kind: "changes" },
        changedBlocks,
      },
    });
    expect(firstJob.statusCode).toBe(202);

    let issue: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const response = await server.inject({
        method: "GET",
        url: `/v1/documents/${documentId}/issues?status=open`,
      });
      const body = response.json();
      expect(body.issues).toHaveLength(1);
      issue = body.issues[0];
    });
    expect(issue).toMatchObject({
      type: "ambiguity",
      status: "open",
      shownCount: 1,
      anchor: {
        nodeId,
        quote: "any model will work equally well",
        detached: false,
        sourceDocumentVersion: 0,
      },
    });

    await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId: "f863cd13-95d3-498e-89c6-2c5f79be0aa1",
        documentVersion: 0,
        trigger: "manual",
        scope: { kind: "changes" },
        changedBlocks,
      },
    });
    await vi.waitFor(() => {
      const count = database.sqlite
        .prepare("select count(*) as count from issues where document_id = ?")
        .get(documentId) as { count: number };
      expect(count.count).toBe(1);
      const completedRuns = database.sqlite
        .prepare(
          "select count(*) as count from model_runs where document_id = ? and kind = 'critic' and status = 'completed'",
        )
        .get(documentId) as { count: number };
      expect(completedRuns.count).toBeGreaterThanOrEqual(2);
    });

    const issueId = String(issue?.id);
    const actionResponse = await server.inject({
      method: "POST",
      url: `/v1/issues/${issueId}/actions`,
      payload: { action: "snooze", documentVersion: 0 },
    });
    expect(actionResponse.statusCode).toBe(200);
    expect(actionResponse.json().issue).toMatchObject({ status: "snoozed" });

    const rewriteResponse = await server.inject({
      method: "POST",
      url: `/v1/issues/${issueId}/actions`,
      payload: {
        action: "apply_rewrite",
        documentVersion: 0,
        expectedAnchorQuote: "any model will work equally well",
      },
    });
    expect(rewriteResponse.statusCode).toBe(200);
    expect(rewriteResponse.json().editorOperation).toEqual({
      nodeId,
      from: text.indexOf("any model will work equally well"),
      to:
        text.indexOf("any model will work equally well") +
        "any model will work equally well".length,
      insertText:
        "models can share an interface while differing in behavior and quality",
    });

    const eventResponse = await server.inject({
      method: "GET",
      url: `/v1/issues/${issueId}/events`,
    });
    expect(
      eventResponse
        .json()
        .events.map((event: { action: string }) => event.action),
    ).toEqual(["show", "snooze", "apply_rewrite"]);

    const loadedResponse = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}`,
    });
    expect(loadedResponse.json().issues).toHaveLength(1);
    expect(loadedResponse.json().issues[0].status).toBe("snoozed");
  });

  it("does not run the automatic critic below forty visible characters", async () => {
    const nodeId = "65539977-9765-4105-bb49-356d54bb30d4";
    const created = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Short note",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [
                { type: "text", text: "any model will work equally well" },
              ],
            },
          ],
        },
      },
    });
    const documentId = created.json().id as string;
    await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId: "5aee8a72-6616-4107-8fd1-d1dcce2e770f",
        documentVersion: 0,
        trigger: "idle",
        scope: { kind: "changes" },
        changedBlocks: [
          {
            nodeId,
            nodeType: "paragraph",
            text: "any model will work equally well",
            headingPath: [],
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const response = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}/issues`,
    });
    expect(response.json().issues).toEqual([]);
  });

  it("remaps changed anchors and reconciles the original issue to resolved", async () => {
    const nodeId = "a1ada4ce-7f27-41ec-9a6d-6034fac83f62";
    const originalText =
      "The whole product is model agnostic, so any model will work equally well.";
    const createdResponse = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Reconciliation note",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: originalText }],
            },
          ],
        },
      },
    });
    const documentId = createdResponse.json().id as string;
    await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId: "fc8fc369-cf07-43ca-9870-7323d16706fe",
        documentVersion: 0,
        trigger: "manual",
        scope: { kind: "changes" },
        changedBlocks: [
          {
            nodeId,
            nodeType: "paragraph",
            text: originalText,
            previousText: "",
            headingPath: [],
          },
        ],
      },
    });

    let issueId = "";
    await vi.waitFor(async () => {
      const response = await server.inject({
        method: "GET",
        url: `/v1/documents/${documentId}/issues`,
      });
      const issue = response.json().issues[0];
      expect(issue).toBeDefined();
      issueId = issue.id;
    });

    const staleRequest = await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/reconcile`,
      payload: { documentVersion: 9, issueIds: [issueId], changedBlocks: [] },
    });
    expect(staleRequest.statusCode).toBe(409);

    const manualRequest = await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/reconcile`,
      payload: { documentVersion: 0, issueIds: [issueId], changedBlocks: [] },
    });
    expect(manualRequest.statusCode).toBe(202);
    expect(manualRequest.json()).toMatchObject({ status: "queued" });

    const revisedText =
      "The harness is API-compatible across providers, but model quality still differs.";
    const saveResponse = await server.inject({
      method: "PUT",
      url: `/v1/documents/${documentId}`,
      payload: {
        baseVersion: 0,
        title: "Reconciliation note",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: revisedText }],
            },
          ],
        },
        plainText: revisedText,
        changeBatch: {
          documentId,
          baseVersion: 0,
          clientSequence: 1,
          changedBlocks: [
            {
              nodeId,
              nodeType: "paragraph",
              text: revisedText,
              previousText: originalText,
              headingPath: [],
            },
          ],
          removedNodeIds: [],
          mergedNodeMap: {},
          reason: "typing",
        },
      },
    });
    expect(saveResponse.statusCode).toBe(200);
    expect(saveResponse.json().impactedIssueIds).toContain(issueId);

    const exportReview = await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/export-review`,
    });
    expect(exportReview.statusCode).toBe(200);
    expect(exportReview.json()).toMatchObject({
      blockingIssues: [],
      needsReconciliation: false,
      openIssueCount: 0,
    });
    const reconciled = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}/issues`,
    });
    expect(reconciled.json().issues[0]).toMatchObject({
      id: issueId,
      status: "resolved",
    });
    const events = await server.inject({
      method: "GET",
      url: `/v1/issues/${issueId}/events`,
    });
    expect(
      events.json().events.map((event: { action: string }) => event.action),
    ).toContain("reconciled_resolved");
    const modelRun = database.sqlite
      .prepare(
        "select status from model_runs where document_id = ? and kind = 'reconcile' order by created_at desc limit 1",
      )
      .get(documentId) as { status: string };
    expect(modelRun.status).toBe("completed");
  });

  it("creates, loads, and saves canonical document content", async () => {
    const nodeId = "f0408a44-037e-46ab-a907-39f510911241";
    const createdResponse = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Harness note",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: "Draft" }],
            },
          ],
        },
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created.plainText).toBe("Draft");
    expect(created.version).toBe(0);

    const savedResponse = await server.inject({
      method: "PUT",
      url: `/v1/documents/${created.id}`,
      payload: {
        baseVersion: 0,
        title: "Harness note",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: "Edited" }],
            },
          ],
        },
        plainText: "untrusted client text",
        changeBatch: {
          documentId: created.id,
          baseVersion: 0,
          clientSequence: 1,
          changedBlocks: [
            {
              nodeId,
              nodeType: "paragraph",
              text: "Edited",
              previousText: "Draft",
              headingPath: [],
            },
          ],
          removedNodeIds: [],
          mergedNodeMap: {},
          reason: "typing",
        },
      },
    });
    expect(savedResponse.statusCode).toBe(200);
    expect(savedResponse.json().document).toMatchObject({
      plainText: "Edited",
      version: 1,
    });

    const loadedResponse = await server.inject({
      method: "GET",
      url: `/v1/documents/${created.id}`,
    });
    expect(loadedResponse.statusCode).toBe(200);
    expect(
      loadedResponse.json().document.contentJson.content[0].attrs.nodeId,
    ).toBe(nodeId);

    const staleResponse = await server.inject({
      method: "PUT",
      url: `/v1/documents/${created.id}`,
      payload: {
        baseVersion: 0,
        title: "Stale",
        contentJson: created.contentJson,
        plainText: "Stale",
        changeBatch: {
          documentId: created.id,
          baseVersion: 0,
          clientSequence: 2,
          changedBlocks: [],
          removedNodeIds: [],
          mergedNodeMap: {},
          reason: "format",
        },
      },
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(staleResponse.json()).toMatchObject({
      error: {
        code: "DOCUMENT_VERSION_CONFLICT",
        details: { currentVersion: 1 },
      },
    });
  });

  it("reviews high-severity loops, enforces force, and exports document-only Markdown", async () => {
    const headingId = "ef51f131-50cd-40e5-9720-e8f784360849";
    const paragraphId = "e99d1ad1-8015-49f5-8d65-216297677e41";
    const claim =
      "The whole product is model agnostic, so any model will work equally well.";
    const created = await server.inject({
      method: "POST",
      url: "/v1/documents",
      payload: {
        title: "Phase 6: Review",
        contentJson: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1, nodeId: headingId },
              content: [{ type: "text", text: "Provider claims" }],
            },
            {
              type: "paragraph",
              attrs: { nodeId: paragraphId },
              content: [
                { type: "text", text: "Important", marks: [{ type: "bold" }] },
                { type: "text", text: `: ${claim}` },
              ],
            },
          ],
        },
      },
    });
    const documentId = created.json().id as string;
    await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/critic-jobs`,
      payload: {
        requestId: "35ac6e0b-cf6b-49a5-aa3f-993cb43bb267",
        documentVersion: 0,
        trigger: "manual",
        scope: { kind: "changes" },
        changedBlocks: [
          {
            nodeId: paragraphId,
            nodeType: "paragraph",
            text: `Important: ${claim}`,
            headingPath: ["Provider claims"],
          },
        ],
      },
    });

    let issueId = "";
    await vi.waitFor(async () => {
      const issues = await server.inject({
        method: "GET",
        url: `/v1/documents/${documentId}/issues`,
      });
      expect(issues.json().issues).toHaveLength(1);
      issueId = issues.json().issues[0].id;
    });

    const review = await server.inject({
      method: "POST",
      url: `/v1/documents/${documentId}/export-review`,
    });
    expect(review.statusCode).toBe(200);
    expect(review.json()).toMatchObject({
      openIssueCount: 1,
      needsReconciliation: false,
      blockingIssues: [{ id: issueId, severity: 4, status: "open" }],
    });

    const blocked = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}/export.md`,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: { code: "EXPORT_BLOCKED" },
    });

    const exported = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}/export.md?force=true`,
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/markdown");
    expect(exported.headers["content-disposition"]).toContain(
      'filename="Phase 6- Review.md"',
    );
    expect(exported.body).toBe(
      `# Provider claims\n\n**Important**: ${claim}\n`,
    );
    expect(exported.body).not.toContain("Do you mean");

    const exportEvent = database.sqlite
      .prepare(
        "select action, document_version as documentVersion, payload_json as payloadJson from document_events where document_id = ?",
      )
      .get(documentId) as {
      action: string;
      documentVersion: number;
      payloadJson: string;
    };
    expect(exportEvent.action).toBe("document_exported");
    expect(JSON.parse(exportEvent.payloadJson)).toEqual({
      openIssueCount: 1,
      blockingIssueCount: 1,
      forced: true,
    });
    expect(exportEvent.payloadJson).not.toContain(claim);

    await server.inject({
      method: "POST",
      url: `/v1/issues/${issueId}/actions`,
      payload: { action: "resolve", documentVersion: 0 },
    });
    const unblocked = await server.inject({
      method: "GET",
      url: `/v1/documents/${documentId}/export.md`,
    });
    expect(unblocked.statusCode).toBe(200);
  });

  it("deletes every local data category in one confirmed request", async () => {
    const issue = database.sqlite
      .prepare("select id, document_id as documentId from issues limit 1")
      .get() as { id: string; documentId: string };
    const now = Date.now();
    database.sqlite
      .prepare(
        "insert into issue_chat_threads (issue_id, document_id, state, created_at, updated_at) values (?, ?, 'idle', ?, ?)",
      )
      .run(issue.id, issue.documentId, now, now);
    database.sqlite
      .prepare(
        "insert into issue_chat_messages (id, issue_id, role, kind, content, attachments_json, created_at) values (?, ?, 'user', 'message', 'private chat text', '[]', ?)",
      )
      .run("f668cf84-34cc-4784-b4ed-5c963096aab3", issue.id, now);

    const tableNames = [
      "issue_chat_messages",
      "issue_chat_threads",
      "issue_events",
      "document_events",
      "issues",
      "model_runs",
      "documents",
      "preference_weights",
    ];
    const counts = () =>
      Object.fromEntries(
        tableNames.map((table) => {
          const row = database.sqlite
            .prepare(`select count(*) as count from ${table}`)
            .get() as { count: number };
          return [table, row.count];
        }),
      );
    const before = counts();
    database.sqlite.exec(
      "create trigger prevent_document_delete before delete on documents begin select raise(abort, 'blocked'); end",
    );
    const failed = await server.inject({
      method: "DELETE",
      url: "/v1/local-data",
    });
    expect(failed.statusCode).toBe(500);
    expect(counts()).toEqual(before);
    database.sqlite.exec("drop trigger prevent_document_delete");

    const response = await server.inject({
      method: "DELETE",
      url: "/v1/local-data",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: true });
    expect(existsSync(environment.TRAINING_TRACE_PATH)).toBe(false);

    for (const table of tableNames) {
      const row = database.sqlite
        .prepare(`select count(*) as count from ${table}`)
        .get() as { count: number };
      expect(row.count, table).toBe(0);
    }
  });
});
