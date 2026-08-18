import { createHash } from "node:crypto";

import {
  CRITIC_PROMPT_VERSION,
  ModelAdapterError,
} from "@openloop/model-adapters";
import type { CriticJobRequest, TextBlockSnapshot } from "@openloop/shared";

import type { Database } from "./db/client.js";
import { getDocument } from "./documents.js";
import { listIssues, persistCriticCandidates } from "./issues.js";
import { createModelRun, finishModelRun } from "./model-runs.js";
import type { SelectedModelAdapter } from "./models/provider.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function visibleLength(blocks: TextBlockSnapshot[]): number {
  return blocks.reduce((total, block) => total + block.text.trim().length, 0);
}

function relevantOpenIssues(
  database: Database,
  documentId: string,
  changedBlocks: TextBlockSnapshot[],
) {
  const changedText = changedBlocks
    .map((block) => block.text.toLocaleLowerCase())
    .join("\n");
  const changedIds = new Set(changedBlocks.map((block) => block.nodeId));
  return listIssues(database, documentId, ["open", "snoozed"])
    .filter(
      (issue) =>
        changedIds.has(issue.anchor.nodeId) ||
        issue.keywords.some((keyword) =>
          changedText.includes(keyword.toLocaleLowerCase()),
        ),
    )
    .map((issue) => ({
      id: issue.id,
      type: issue.type,
      question: issue.question,
      anchorQuote: issue.anchor.quote,
      status: issue.status,
    }));
}

export async function runCriticJob(input: {
  database: Database;
  selectedModel: SelectedModelAdapter;
  documentId: string;
  jobId: string;
  request: CriticJobRequest;
  logger?: {
    info: (metadata: object, message: string) => void;
  };
}): Promise<ReturnType<typeof persistCriticCandidates>> {
  const document = getDocument(input.database, input.documentId);
  if (
    input.request.changedBlocks.length === 0 ||
    (input.request.trigger !== "manual" &&
      Math.max(
        document.plainText.trim().length,
        visibleLength(input.request.changedBlocks),
      ) < 40)
  ) {
    return [];
  }

  const inputHash = sha256(
    JSON.stringify({
      documentId: input.documentId,
      documentVersion: input.request.documentVersion,
      changedBlocks: input.request.changedBlocks.map((block) => ({
        nodeId: block.nodeId,
        textHash: sha256(block.text),
      })),
    }),
  );
  const runId = createModelRun(input.database, {
    requestId: input.request.requestId,
    documentId: input.documentId,
    kind: "critic",
    provider: input.selectedModel.adapter.providerId,
    model: input.selectedModel.criticModel,
    inputHash,
  });
  const startedAt = performance.now();
  input.logger?.info(
    {
      modelRun: {
        requestId: input.request.requestId,
        provider: input.selectedModel.adapter.providerId,
        model: input.selectedModel.criticModel,
        promptVersion: CRITIC_PROMPT_VERSION,
        inputHash,
      },
    },
    "Critic model run started",
  );
  try {
    const candidates = await input.selectedModel.adapter.critique(
      {
        requestId: input.request.requestId,
        documentTitle: document.title,
        documentVersion: input.request.documentVersion,
        changedBlocks: input.request.changedBlocks,
        openIssues: relevantOpenIssues(
          input.database,
          input.documentId,
          input.request.changedBlocks,
        ),
      },
      new AbortController().signal,
    );
    const results = persistCriticCandidates(input.database, {
      document,
      documentVersion: input.request.documentVersion,
      changedBlocks: input.request.changedBlocks,
      candidates,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    finishModelRun(input.database, {
      id: runId,
      status: "completed",
      latencyMs,
    });
    input.logger?.info(
      {
        modelRun: {
          requestId: input.request.requestId,
          promptVersion: CRITIC_PROMPT_VERSION,
          latencyMs,
          status: "completed",
          issueCount: results.length,
        },
      },
      "Critic model run finished",
    );
    return results;
  } catch (error) {
    const modelError =
      error instanceof ModelAdapterError
        ? error
        : new ModelAdapterError(
            "MODEL_UNAVAILABLE",
            "The critic provider failed.",
            {
              cause: error,
            },
          );
    finishModelRun(input.database, {
      id: runId,
      status: modelError.code === "MODEL_ABORTED" ? "aborted" : "error",
      latencyMs: Math.round(performance.now() - startedAt),
      errorCode: modelError.code,
    });
    throw modelError;
  }
}

export { CRITIC_PROMPT_VERSION };
