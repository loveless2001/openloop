import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildServer } from "../src/app.js";
import { readEnvironment } from "../src/config/env.js";
import { openDatabase, type Database } from "../src/db/client.js";

const tempDirectory = mkdtempSync(join(tmpdir(), "openloop-server-"));
const environment = readEnvironment({
  NODE_ENV: "test",
  DATABASE_URL: `file:${join(tempDirectory, "test.db")}`,
  MODEL_PROVIDER: "mock",
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

  it("allows the mock provider without a key and rejects incomplete remote configuration", () => {
    expect(environment.MODEL_PROVIDER).toBe("mock");
    expect(() =>
      readEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: "file:./data/openloop.db",
        MODEL_PROVIDER: "openai-compatible",
        MODEL_API_KEY: "",
      }),
    ).toThrow();
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
