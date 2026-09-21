import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MockWritingEvaluator,
  TypeSafeWritingEvaluator,
  type WritingEvaluator,
} from "@openloop/model-adapters";
import type { CompiledWritingEvaluation } from "@openloop/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../src/app.js";
import { readEnvironment } from "../src/config/env.js";
import { openDatabase, type Database } from "../src/db/client.js";

const nodeId = "11111111-1111-4111-8111-111111111111";
const criterionId = "22222222-2222-4222-8222-222222222222";

const criticAgentSupervisor = {
  status: vi.fn(async () => ({
    state: "stopped" as const,
    agent: "codex" as const,
    sessionName: "openloop-critic" as const,
    attachCommand: "tmux attach -t openloop-critic" as const,
    message: "ready",
  })),
  launch: vi.fn(),
};

function testEnvironment(databasePath: string) {
  return readEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: `file:${databasePath}`,
    COMPLETION_PROVIDER: "mock",
    CRITIC_PROVIDER: "mock",
    EVALUATOR_PROVIDER: "mock",
  });
}

async function createDocument(server: ReturnType<typeof buildServer>) {
  const response = await server.inject({
    method: "POST",
    url: "/v1/documents",
    payload: {
      title: "Evaluation draft",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId },
            content: [{ type: "text", text: "A claim because a reason." }],
          },
        ],
      },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as {
    id: string;
    version: number;
    contentJson: object;
  };
}

async function createRubric(server: ReturnType<typeof buildServer>) {
  const response = await server.inject({
    method: "POST",
    url: "/v1/writing-rubrics",
    payload: {
      title: "Support",
      purpose: "Explain the claim.",
      audience: "Readers",
      criteria: [
        {
          id: criterionId,
          name: "Support",
          question: "Is the claim supported by a reason?",
          allowedScopes: ["selection", "document"],
          levels: [
            { label: "Low", description: "No reason is supplied." },
            { label: "Some", description: "A partial reason is supplied." },
            { label: "Strong", description: "A clear reason is supplied." },
          ],
        },
      ],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string; revision: number };
}

function intent(
  documentVersion: number,
  rubric: { id: string; revision: number },
) {
  return {
    documentVersion,
    rubricId: rubric.id,
    rubricRevision: rubric.revision,
    scope: { kind: "document" as const },
    languageHint: "en" as const,
  };
}

async function waitForTerminal(
  server: ReturnType<typeof buildServer>,
  runId: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await server.inject({
      method: "GET",
      url: `/v1/evaluations/${runId}`,
    });
    const run = response.json() as { status: string };
    if (
      ["completed", "failed", "cancelled", "interrupted"].includes(run.status)
    ) {
      return response.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Evaluation did not finish.");
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("writing evaluation routes", () => {
  it("persists a mock-backed result, preserves its rubric snapshot, and enforces idempotency", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openloop-writing-eval-"));
    const database = openDatabase(`file:${join(directory, "test.db")}`);
    const server = buildServer({
      environment: testEnvironment(join(directory, "test.db")),
      database,
      logger: false,
      criticAgentSupervisor,
      mcpBearerToken: "test-token",
      reconciliationIdleMs: 0,
    });
    cleanups.push(async () => {
      await server.close();
      database.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    });
    await server.ready();

    expect(
      (
        await server.inject({ method: "GET", url: "/v1/evaluator-status" })
      ).json(),
    ).toMatchObject({
      providerId: "mock",
      configured: true,
      label: "Mock — UI test only",
    });
    const document = await createDocument(server);
    const rubric = await createRubric(server);
    const previewResponse = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations/preview`,
      payload: intent(0, rubric),
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json() as { inputHash: string };
    const requestId = "33333333-3333-4333-8333-333333333333";
    const submission = {
      ...intent(0, rubric),
      requestId,
      expectedInputHash: preview.inputHash,
      remoteSubmissionConfirmed: false,
    };
    const accepted = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations`,
      payload: submission,
    });
    expect(accepted.statusCode).toBe(202);
    const runId = (accepted.json() as { id: string }).id;
    const completed = (await waitForTerminal(server, runId)) as {
      status: string;
      result: { criteria: Array<{ status: string }> };
      snapshot: {
        rubricSnapshot: {
          criteria: Array<{ levels: Array<{ description: string }> }>;
        };
      };
    };
    expect(completed.status).toBe("completed");
    expect(completed.result.criteria[0]?.status).toBe("assessed");

    const selectionOnlyRubric = (
      await server.inject({
        method: "POST",
        url: "/v1/writing-rubrics",
        payload: {
          title: "Selection only",
          purpose: "",
          audience: "",
          criteria: [
            {
              id: "99999999-9999-4999-8999-999999999999",
              name: "Local scope gate",
              question: "Can this selection be judged?",
              allowedScopes: ["selection"],
              levels: [
                { label: "Low", description: "Low selection alignment." },
                { label: "Some", description: "Some selection alignment." },
                { label: "Strong", description: "Strong selection alignment." },
              ],
            },
          ],
        },
      })
    ).json() as { id: string; revision: number };
    const localIntent = intent(0, selectionOnlyRubric);
    const localPreview = (
      await server.inject({
        method: "POST",
        url: `/v1/documents/${document.id}/evaluations/preview`,
        payload: localIntent,
      })
    ).json() as { inputHash: string };
    const localRun = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations`,
      payload: {
        ...localIntent,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedInputHash: localPreview.inputHash,
        remoteSubmissionConfirmed: false,
      },
    });
    expect(localRun.json()).toMatchObject({
      status: "completed",
      providerCalled: false,
      usage: { inputTokens: 0, outputTokens: 0 },
      result: {
        criteria: [{ status: "incompatible_scope" }],
      },
    });
    expect(localRun.json()).not.toHaveProperty("returnedModel");

    const edited = await server.inject({
      method: "PUT",
      url: `/v1/writing-rubrics/${rubric.id}`,
      payload: {
        baseRevision: 1,
        title: "Support revised",
        purpose: "Explain the claim.",
        audience: "Readers",
        criteria: [
          {
            id: criterionId,
            name: "Support",
            question: "Is the claim supported by a reason?",
            allowedScopes: ["selection", "document"],
            levels: [
              { label: "Low", description: "Revised low description." },
              { label: "Some", description: "Revised middle description." },
              { label: "Strong", description: "Revised strong description." },
            ],
          },
        ],
      },
    });
    expect(edited.json()).toMatchObject({ revision: 2 });
    const retained = await server.inject({
      method: "GET",
      url: `/v1/evaluations/${runId}`,
    });
    expect(
      retained.json().snapshot.rubricSnapshot.criteria[0].levels[0].description,
    ).toBe("No reason is supplied.");

    const saved = await server.inject({
      method: "PUT",
      url: `/v1/documents/${document.id}`,
      payload: {
        baseVersion: 0,
        title: "Evaluation draft",
        contentJson: document.contentJson,
        plainText: "ignored",
        changeBatch: {
          documentId: document.id,
          baseVersion: 0,
          clientSequence: 1,
          changedBlocks: [],
          removedNodeIds: [],
          mergedNodeMap: {},
          reason: "format",
        },
      },
    });
    expect(saved.statusCode).toBe(200);

    const idempotent = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations`,
      payload: submission,
    });
    expect(idempotent.statusCode).toBe(202);
    expect(idempotent.json().id).toBe(runId);

    const reusedDifferently = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations`,
      payload: { ...submission, languageHint: "vi" },
    });
    expect(reusedDifferently.statusCode).toBe(409);
    expect(reusedDifferently.json().error.code).toBe(
      "EVALUATION_REQUEST_CONFLICT",
    );

    const stale = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations`,
      payload: {
        ...submission,
        requestId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("DOCUMENT_VERSION_CONFLICT");
  });

  it("requires remote confirmation and persists a native TypeSafe response", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openloop-writing-remote-"));
    const databasePath = join(directory, "test.db");
    const database = openDatabase(`file:${databasePath}`);
    let sentBody: unknown;
    const evaluator = new TypeSafeWritingEvaluator({
      apiKey: "test-typesafe-key",
      baseUrl: "http://127.0.0.1:9999/v1",
      timeoutMs: 1_000,
      allowInsecureLoopback: true,
      fetchImplementation: vi.fn(async (_input, init) => {
        sentBody = JSON.parse(String(init?.body));
        const scoreKey = `criterion_${criterionId.replaceAll("-", "_")}__score`;
        const assessabilityKey = `criterion_${criterionId.replaceAll("-", "_")}__assessability`;
        return new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: {
              [scoreKey]: {
                type: "score",
                score: 1.7,
                confidence: 0.8,
                probabilities: { "0": 0.05, "1": 0.2, "2": 0.75 },
                legend: {
                  "0": "No reason is supplied.",
                  "1": "A partial reason is supplied.",
                  "2": "A clear reason is supplied.",
                },
              },
              [assessabilityKey]: {
                type: "choice",
                choice: "assessable",
                confidence: 0.9,
                probabilities: {
                  assessable: 0.9,
                  needs_context: 0.06,
                  not_applicable: 0.04,
                },
              },
            },
            usage: { input_tokens: 101, output_tokens: 22 },
          }),
          { status: 200 },
        );
      }),
    });
    const server = buildServer({
      environment: readEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: `file:${databasePath}`,
        COMPLETION_PROVIDER: "mock",
        CRITIC_PROVIDER: "mock",
        EVALUATOR_PROVIDER: "typesafe",
        TYPESAFE_API_KEY: "test-typesafe-key",
        JEV_API_BASE_URL: "http://127.0.0.1:9999/v1",
      }),
      database,
      logger: false,
      criticAgentSupervisor,
      mcpBearerToken: "test-token",
      reconciliationIdleMs: 0,
      writingEvaluator: evaluator,
    });
    cleanups.push(async () => {
      await server.close();
      database.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    });
    await server.ready();

    expect(
      (
        await server.inject({ method: "GET", url: "/v1/evaluator-status" })
      ).json(),
    ).toMatchObject({
      providerId: "typesafe",
      mode: "remote",
      configured: true,
      destination: "127.0.0.1:9999",
    });
    const document = await createDocument(server);
    const rubric = await createRubric(server);
    const preview = (
      await server.inject({
        method: "POST",
        url: `/v1/documents/${document.id}/evaluations/preview`,
        payload: intent(0, rubric),
      })
    ).json() as { inputHash: string };
    const submission = {
      ...intent(0, rubric),
      requestId: "12121212-1212-4212-8212-121212121212",
      expectedInputHash: preview.inputHash,
      remoteSubmissionConfirmed: false,
    };
    const unconfirmed = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations`,
      payload: submission,
    });
    expect(unconfirmed.statusCode).toBe(503);
    expect(unconfirmed.json().error.code).toBe("EVALUATOR_NOT_CONFIGURED");

    const accepted = await server.inject({
      method: "POST",
      url: `/v1/documents/${document.id}/evaluations`,
      payload: { ...submission, remoteSubmissionConfirmed: true },
    });
    expect(accepted.statusCode).toBe(202);
    const completed = (await waitForTerminal(
      server,
      accepted.json().id as string,
    )) as {
      status: string;
      returnedModel: string;
      usage: { inputTokens: number; outputTokens: number };
    };
    expect(completed).toMatchObject({
      status: "completed",
      returnedModel: "jev-1.13.0",
      usage: { inputTokens: 101, outputTokens: 22 },
    });
    expect(sentBody).toMatchObject({
      model: "jev-1.13.0",
      state: { target: { scope: "document" } },
      questions: {
        [`criterion_${criterionId.replaceAll("-", "_")}__score`]: {
          type: "score",
        },
        [`criterion_${criterionId.replaceAll("-", "_")}__assessability`]: {
          type: "choice",
        },
      },
    });
  });
});

class GateEvaluator implements WritingEvaluator {
  readonly providerId = "mock" as const;
  readonly releases: Array<() => void> = [];
  private readonly delegate = new MockWritingEvaluator();

  async evaluate(input: CompiledWritingEvaluation, signal: AbortSignal) {
    await new Promise<void>((resolve) => this.releases.push(resolve));
    return this.delegate.evaluate(input, signal);
  }
}

describe("writing evaluation queue", () => {
  it("bounds work, cancels queued jobs, interrupts restart work, and prevents deleted-run resurrection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openloop-writing-queue-"));
    const databasePath = join(directory, "test.db");
    const database: Database = openDatabase(`file:${databasePath}`);
    const evaluator = new GateEvaluator();
    const server = buildServer({
      environment: testEnvironment(databasePath),
      database,
      logger: false,
      criticAgentSupervisor,
      mcpBearerToken: "test-token",
      reconciliationIdleMs: 0,
      writingEvaluator: evaluator,
    });
    cleanups.push(() => {
      if (database.sqlite.open) database.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    });
    await server.ready();
    const document = await createDocument(server);
    const rubric = await createRubric(server);
    const preview = (
      await server.inject({
        method: "POST",
        url: `/v1/documents/${document.id}/evaluations/preview`,
        payload: intent(0, rubric),
      })
    ).json() as { inputHash: string };

    const submit = (requestId: string) =>
      server.inject({
        method: "POST",
        url: `/v1/documents/${document.id}/evaluations`,
        payload: {
          ...intent(0, rubric),
          requestId,
          expectedInputHash: preview.inputHash,
          remoteSubmissionConfirmed: false,
        },
      });
    const first = await submit("55555555-5555-4555-8555-555555555555");
    const second = await submit("66666666-6666-4666-8666-666666666666");
    const third = await submit("77777777-7777-4777-8777-777777777777");
    const fourth = await submit("88888888-8888-4888-8888-888888888888");
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe("EVALUATION_BUSY");

    const thirdId = third.json().id as string;
    const cancelled = await server.inject({
      method: "POST",
      url: `/v1/evaluations/${thirdId}/cancel`,
    });
    expect(cancelled.json().status).toBe("cancelled");

    const firstId = first.json().id as string;
    expect(
      (
        await server.inject({
          method: "DELETE",
          url: `/v1/evaluations/${firstId}`,
        })
      ).statusCode,
    ).toBe(204);
    evaluator.releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/v1/evaluations/${firstId}`,
        })
      ).statusCode,
    ).toBe(404);

    await server.close();
    const secondId = second.json().id as string;
    const interrupted = database.sqlite
      .prepare("select status from writing_evaluation_runs where id = ?")
      .get(secondId) as { status: string };
    expect(interrupted.status).toBe("interrupted");
    evaluator.releases.shift()?.();
  });
});
