import { randomUUID } from "node:crypto";

import { ModelAdapterError } from "@openloop/model-adapters";
import type { CriticJobRequest, TextBlockSnapshot } from "@openloop/shared";

import type { CriticEventBroker } from "./critic-events.js";
import { runCriticJob } from "./critic-service.js";
import type { Database } from "./db/client.js";
import type { SelectedModelAdapters } from "./models/provider.js";

interface CriticJob {
  id: string;
  documentId: string;
  request: CriticJobRequest;
}

export class CriticQueueFullError extends Error {
  readonly code = "CRITIC_QUEUE_FULL";
}

const triggerPriority: Record<CriticJobRequest["trigger"], number> = {
  idle: 0,
  paragraph_end: 1,
  word_threshold: 2,
  heading_created: 3,
  manual: 4,
};

function mergeBlocks(
  older: TextBlockSnapshot[],
  newer: TextBlockSnapshot[],
): TextBlockSnapshot[] {
  const merged = new Map(older.map((block) => [block.nodeId, block]));
  for (const block of newer) merged.set(block.nodeId, block);
  return [...merged.values()];
}

export class CriticQueue {
  private activeCount = 0;
  private readonly pending: CriticJob[] = [];
  private readonly runningByDocument = new Map<string, CriticJob>();

  constructor(
    private readonly database: Database,
    private readonly selectedModel: SelectedModelAdapters,
    private readonly broker: CriticEventBroker,
    private readonly logger?: {
      info: (metadata: object, message: string) => void;
    },
    private readonly enqueueReconciliation?: (input: {
      documentId: string;
      documentVersion: number;
      issueIds: string[];
      changedBlocks: TextBlockSnapshot[];
    }) => void,
  ) {}

  enqueue(documentId: string, request: CriticJobRequest): string {
    const running = this.runningByDocument.get(documentId);
    if (
      running?.request.documentVersion === request.documentVersion &&
      request.scope.kind !== "selection"
    ) {
      return running.id;
    }
    const queued = this.pending.find((job) => job.documentId === documentId);
    if (queued) {
      if (request.scope.kind === "selection") {
        queued.request = request;
        return queued.id;
      }
      if (queued.request.scope.kind === "selection") return queued.id;
      queued.request = {
        ...request,
        trigger:
          triggerPriority[request.trigger] >
          triggerPriority[queued.request.trigger]
            ? request.trigger
            : queued.request.trigger,
        changedBlocks: mergeBlocks(
          queued.request.changedBlocks,
          request.changedBlocks,
        ),
      };
      return queued.id;
    }
    if (this.pending.length >= 3) {
      throw new CriticQueueFullError("The critic queue is full.");
    }

    const job = { id: randomUUID(), documentId, request };
    this.pending.push(job);
    queueMicrotask(() => this.pump());
    return job.id;
  }

  private pump(): void {
    while (this.activeCount < 3) {
      const index = this.pending.findIndex(
        (job) => !this.runningByDocument.has(job.documentId),
      );
      if (index < 0) return;
      const [job] = this.pending.splice(index, 1);
      if (!job) return;
      this.activeCount += 1;
      this.runningByDocument.set(job.documentId, job);
      void this.run(job).finally(() => {
        this.activeCount -= 1;
        this.runningByDocument.delete(job.documentId);
        this.pump();
      });
    }
  }

  private async run(job: CriticJob): Promise<void> {
    try {
      const persisted = await runCriticJob({
        database: this.database,
        selectedModel: this.selectedModel,
        documentId: job.documentId,
        jobId: job.id,
        request: job.request,
        logger: this.logger,
      });
      for (const result of persisted) {
        this.broker.emit(job.documentId, {
          event: result.kind === "created" ? "issue_created" : "issue_updated",
          data: {
            issue: result.issue,
            jobId: job.id,
            ...(result.resurfaceTrigger
              ? { trigger: result.resurfaceTrigger }
              : {}),
          },
        });
        if (result.kind === "created" && result.issue.shownCount > 0) {
          this.broker.emit(job.documentId, {
            event: "issue_eligible",
            data: {
              issue: result.issue,
              jobId: job.id,
              automatic: job.request.trigger !== "manual",
            },
          });
        }
      }
      const reconciliationIds = persisted
        .filter((result) => result.needsReconciliation)
        .map((result) => result.issue.id);
      if (reconciliationIds.length > 0) {
        this.enqueueReconciliation?.({
          documentId: job.documentId,
          documentVersion: job.request.documentVersion,
          issueIds: reconciliationIds,
          changedBlocks: job.request.changedBlocks,
        });
      }
    } catch (error) {
      const modelError =
        error instanceof ModelAdapterError
          ? error
          : new ModelAdapterError("MODEL_UNAVAILABLE", "Critic unavailable.", {
              cause: error,
            });
      this.broker.emit(job.documentId, {
        event: "critic_error",
        data: {
          code: modelError.code,
          message: modelError.message,
          jobId: job.id,
        },
      });
    }
  }
}
