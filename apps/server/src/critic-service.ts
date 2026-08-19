import { createHash } from "node:crypto";

import {
  CRITIC_PROMPT_VERSION,
  ModelAdapterError,
  type CriticContextProvider,
} from "@openloop/model-adapters";
import type { CriticJobRequest, TextBlockSnapshot } from "@openloop/shared";

import type { Database } from "./db/client.js";
import { getDocument } from "./documents.js";
import {
  documentBlocks,
  listIssues,
  persistCriticCandidates,
} from "./issues.js";
import { createModelRun, finishModelRun } from "./model-runs.js";
import type { SelectedModelAdapters } from "./models/provider.js";

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

const MAX_CONTEXT_REQUESTS = 2;
const MAX_CONTEXT_BLOCKS_PER_SIDE = 6;

function createContextProvider(
  documentContent: Parameters<typeof documentBlocks>[0],
  focusedBlocks: TextBlockSnapshot[],
): CriticContextProvider {
  const blocks = documentBlocks(documentContent);
  const focusedIds = new Set(focusedBlocks.map((block) => block.nodeId));
  const focusedIndices = blocks
    .map((block, index) => (focusedIds.has(block.nodeId) ? index : -1))
    .filter((index) => index >= 0);
  const firstIndex = Math.min(...focusedIndices);
  const lastIndex = Math.max(...focusedIndices);
  const snapshot = (block: (typeof blocks)[number]): TextBlockSnapshot => ({
    ...block,
  });

  return async ({ beforeBlocks, afterBlocks }, signal) => {
    if (signal.aborted) {
      throw new ModelAdapterError(
        "MODEL_ABORTED",
        "The critic context request was aborted.",
      );
    }
    if (!focusedIndices.length) return { beforeBlocks: [], afterBlocks: [] };
    return {
      beforeBlocks: blocks
        .slice(Math.max(0, firstIndex - beforeBlocks), firstIndex)
        .map(snapshot),
      afterBlocks: blocks
        .slice(lastIndex + 1, lastIndex + 1 + afterBlocks)
        .map(snapshot),
    };
  };
}

export async function runCriticJob(input: {
  database: Database;
  selectedModel: SelectedModelAdapters;
  documentId: string;
  jobId: string;
  request: CriticJobRequest;
  logger?: {
    info: (metadata: object, message: string) => void;
  };
}): Promise<ReturnType<typeof persistCriticCandidates>> {
  const document = getDocument(input.database, input.documentId);
  if (document.version !== input.request.documentVersion) {
    throw new ModelAdapterError(
      "MODEL_ABORTED",
      "The critic request targets an older document version.",
    );
  }
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
    provider: input.selectedModel.critic.adapter.providerId,
    model: input.selectedModel.critic.model,
    inputHash,
  });
  const startedAt = performance.now();
  input.logger?.info(
    {
      modelRun: {
        requestId: input.request.requestId,
        provider: input.selectedModel.critic.adapter.providerId,
        model: input.selectedModel.critic.model,
        promptVersion: CRITIC_PROMPT_VERSION,
        inputHash,
      },
    },
    "Critic model run started",
  );
  try {
    const candidates = await input.selectedModel.critic.adapter.critique(
      {
        requestId: input.request.requestId,
        documentTitle: document.title,
        documentVersion: input.request.documentVersion,
        scope: input.request.scope,
        changedBlocks: input.request.changedBlocks,
        contextPolicy: {
          canRequestMore: true,
          maxRequests: MAX_CONTEXT_REQUESTS,
          maxBlocksPerSide: MAX_CONTEXT_BLOCKS_PER_SIDE,
        },
        openIssues: relevantOpenIssues(
          input.database,
          input.documentId,
          input.request.changedBlocks,
        ),
      },
      new AbortController().signal,
      createContextProvider(document.contentJson, input.request.changedBlocks),
    );
    const currentDocument = getDocument(input.database, input.documentId);
    if (currentDocument.version !== input.request.documentVersion) {
      throw new ModelAdapterError(
        "MODEL_ABORTED",
        "The document changed before the critic result was submitted.",
      );
    }
    const results = persistCriticCandidates(input.database, {
      document: currentDocument,
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
