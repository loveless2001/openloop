import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  CRITIC_PROVIDER: "mock",
  CAPTURE_TRAINING_TRACES: "true",
  TRAINING_TRACE_PATH: join(tempDirectory, "completion-traces.jsonl"),
});
let database: Database;
let server: ReturnType<typeof buildServer>;

beforeAll(async () => {
  database = openDatabase(environment.DATABASE_URL);
  server = buildServer({ environment, database, logger: false });
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

    const tables = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name in ('documents', 'issues', 'issue_events', 'model_runs', 'preference_weights') order by name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual([
      "documents",
      "issue_events",
      "issues",
      "model_runs",
      "preference_weights",
    ]);

    const indexes = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'index' and name not like 'sqlite_autoindex%' order by name",
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map(({ name }) => name)).toEqual([
      "issue_events_document_created_idx",
      "issue_events_issue_created_idx",
      "issues_document_dedupe_idx",
      "issues_document_status_idx",
      "issues_document_updated_idx",
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
});
