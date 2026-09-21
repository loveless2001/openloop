import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildServer } from "../apps/server/src/app.js";
import { loadEnvironment } from "../apps/server/src/config/env.js";
import { openDatabase } from "../apps/server/src/db/client.js";

const loaded = loadEnvironment();
if (!loaded.TYPESAFE_API_KEY.trim()) {
  throw new Error(
    "Set TYPESAFE_API_KEY in .env before running the Jev smoke test.",
  );
}

const directory = mkdtempSync(join(tmpdir(), "openloop-jev-smoke-"));
const database = openDatabase(`file:${join(directory, "smoke.db")}`);
const server = buildServer({
  environment: {
    ...loaded,
    NODE_ENV: "test",
    COMPLETION_PROVIDER: "mock",
    CRITIC_PROVIDER: "mock",
    EVALUATOR_PROVIDER: "typesafe",
    DATABASE_URL: `file:${join(directory, "smoke.db")}`,
  },
  database,
  logger: false,
  mcpBearerToken: "jev-smoke-local-token",
  reconciliationIdleMs: 0,
  criticAgentSupervisor: {
    async status() {
      return {
        state: "stopped" as const,
        agent: "codex" as const,
        sessionName: "openloop-critic" as const,
        attachCommand: "tmux attach -t openloop-critic" as const,
        message: "Not used by the Jev smoke test.",
      };
    },
    async launch() {
      return this.status();
    },
  },
});

try {
  await server.ready();
  const documentResponse = await server.inject({
    method: "POST",
    url: "/v1/documents",
    payload: {
      title: "Jev smoke test",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: randomUUID() },
            content: [
              {
                type: "text",
                text: "The release is ready because all targeted tests pass and the migration is forward-only.",
              },
            ],
          },
        ],
      },
    },
  });
  if (documentResponse.statusCode !== 201) {
    throw new Error(
      `Could not create smoke document (${documentResponse.statusCode}).`,
    );
  }
  const document = documentResponse.json() as { id: string; version: number };

  const rubricResponse = await server.inject({
    method: "POST",
    url: "/v1/writing-rubrics",
    payload: {
      title: "Evidence support",
      purpose: "State a release-readiness claim with concrete support.",
      audience: "Software maintainers",
      criteria: [
        {
          id: randomUUID(),
          name: "Claim support",
          question:
            "Is the release-readiness claim supported by concrete evidence?",
          allowedScopes: ["document"],
          levels: [
            {
              label: "Unsupported",
              description: "The claim has no concrete supporting evidence.",
            },
            {
              label: "Partly supported",
              description:
                "The claim names evidence, but it is incomplete or weakly connected.",
            },
            {
              label: "Supported",
              description:
                "The claim is directly supported by specific, relevant evidence.",
            },
          ],
        },
      ],
    },
  });
  if (rubricResponse.statusCode !== 201) {
    throw new Error(
      `Could not create smoke rubric (${rubricResponse.statusCode}).`,
    );
  }
  const rubric = rubricResponse.json() as { id: string; revision: number };
  const intent = {
    documentVersion: document.version,
    rubricId: rubric.id,
    rubricRevision: rubric.revision,
    scope: { kind: "document" as const },
    languageHint: "en" as const,
  };
  const previewResponse = await server.inject({
    method: "POST",
    url: `/v1/documents/${document.id}/evaluations/preview`,
    payload: intent,
  });
  if (previewResponse.statusCode !== 200) {
    throw new Error(
      `Could not prepare smoke evaluation (${previewResponse.statusCode}).`,
    );
  }
  const preview = previewResponse.json() as {
    inputHash: string;
    byteCount: number;
  };
  const submissionResponse = await server.inject({
    method: "POST",
    url: `/v1/documents/${document.id}/evaluations`,
    payload: {
      ...intent,
      requestId: randomUUID(),
      expectedInputHash: preview.inputHash,
      remoteSubmissionConfirmed: true,
    },
  });
  if (submissionResponse.statusCode !== 202) {
    throw new Error(
      `Could not submit smoke evaluation (${submissionResponse.statusCode}).`,
    );
  }
  const submitted = submissionResponse.json() as { id: string };
  let run: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < 140; attempt += 1) {
    const response = await server.inject({
      method: "GET",
      url: `/v1/evaluations/${submitted.id}`,
    });
    run = response.json() as Record<string, unknown>;
    if (
      ["completed", "failed", "cancelled", "interrupted"].includes(
        String(run.status),
      )
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!run || run.status === "queued" || run.status === "running") {
    throw new Error("The Jev smoke evaluation did not reach a terminal state.");
  }

  const result = run.result as
    | {
        criteria?: Array<{
          status?: string;
          primaryLevel?: number;
          mixed?: boolean;
        }>;
      }
    | undefined;
  process.stdout.write(
    `${JSON.stringify(
      {
        status: run.status,
        failure: run.failure,
        requestedModel: run.requestedModel,
        returnedModel: run.returnedModel,
        durationMs: run.durationMs,
        usage: run.usage,
        preparedBytes: preview.byteCount,
        criterion: result?.criteria?.[0],
      },
      null,
      2,
    )}\n`,
  );
  if (run.status !== "completed") process.exitCode = 1;
} finally {
  await server.close();
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
}
