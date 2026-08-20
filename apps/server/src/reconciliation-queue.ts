import { createHash, randomUUID } from "node:crypto";

import {
  ModelAdapterError,
  RECONCILE_PROMPT_VERSION,
} from "@openloop/model-adapters";
import type { TextBlockSnapshot } from "@openloop/shared";

import type { CriticEventBroker } from "./critic-events.js";
import type { Database } from "./db/client.js";
import { getDocument } from "./documents.js";
import { getIssue } from "./issues.js";
import { createModelRun, finishModelRun } from "./model-runs.js";
import type { SelectedModelAdapters } from "./models/provider.js";
import {
  persistReconciliationResult,
  reconciliationContext,
} from "./reconciliation.js";

interface PendingDocument {
  jobId: string;
  documentVersion: number;
  issueIds: Set<string>;
  changedBlocks: Map<string, TextBlockSnapshot>;
  timer?: ReturnType<typeof setTimeout>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class ReconciliationQueue {
  private readonly pending = new Map<string, PendingDocument>();
  private readonly runningDocuments = new Set<string>();

  constructor(
    private readonly database: Database,
    private readonly selectedModel: SelectedModelAdapters,
    private readonly broker: CriticEventBroker,
    private readonly idleMs = 2_000,
    private readonly logger?: {
      info: (metadata: object, message: string) => void;
    },
  ) {}

  enqueue(input: {
    documentId: string;
    documentVersion: number;
    issueIds: string[];
    changedBlocks: TextBlockSnapshot[];
  }): string {
    const existing = this.pending.get(input.documentId);
    const pending: PendingDocument = existing ?? {
      jobId: randomUUID(),
      documentVersion: input.documentVersion,
      issueIds: new Set(),
      changedBlocks: new Map(),
    };
    pending.documentVersion = Math.max(
      pending.documentVersion,
      input.documentVersion,
    );
    for (const issueId of input.issueIds) pending.issueIds.add(issueId);
    for (const block of input.changedBlocks) {
      pending.changedBlocks.set(block.nodeId, block);
    }
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      void this.pump(input.documentId);
    }, this.idleMs);
    this.pending.set(input.documentId, pending);
    return pending.jobId;
  }

  close(): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pending.clear();
  }

  private async pump(documentId: string): Promise<void> {
    if (this.runningDocuments.has(documentId)) return;
    const pending = this.pending.get(documentId);
    if (!pending) return;
    this.pending.delete(documentId);
    this.runningDocuments.add(documentId);
    const issueIds = [...pending.issueIds];
    const batch = issueIds.slice(0, 5);
    try {
      for (const issueId of batch) {
        await this.runIssue(documentId, pending.documentVersion, issueId, [
          ...pending.changedBlocks.values(),
        ]);
      }
    } finally {
      this.runningDocuments.delete(documentId);
      const remaining = issueIds.slice(5);
      if (remaining.length > 0) {
        this.enqueue({
          documentId,
          documentVersion: pending.documentVersion,
          issueIds: remaining,
          changedBlocks: [...pending.changedBlocks.values()],
        });
      }
      const next = this.pending.get(documentId);
      if (next && !next.timer) {
        next.timer = setTimeout(() => {
          next.timer = undefined;
          void this.pump(documentId);
        }, this.idleMs);
      }
    }
  }

  private async runIssue(
    documentId: string,
    requestedVersion: number,
    issueId: string,
    changedBlocks: TextBlockSnapshot[],
  ): Promise<void> {
    const document = getDocument(this.database, documentId);
    const issue = getIssue(this.database, issueId);
    if (
      issue.documentId !== documentId ||
      !["open", "snoozed", "needs_review"].includes(issue.status)
    ) {
      return;
    }
    if (document.version !== requestedVersion) {
      this.enqueue({
        documentId,
        documentVersion: document.version,
        issueIds: [issueId],
        changedBlocks: [],
      });
      return;
    }

    const requestId = randomUUID();
    const context = reconciliationContext(document, issue, changedBlocks);
    const inputHash = sha256(
      JSON.stringify({
        issueId,
        documentVersion: document.version,
        anchorFingerprint: issue.anchor.normalizedFingerprint,
        currentBlockHash: context.currentBlock
          ? sha256(context.currentBlock.text)
          : undefined,
        nearbyBlockHashes: context.nearbyBlocks.map((block) =>
          sha256(block.text),
        ),
      }),
    );
    const runId = createModelRun(this.database, {
      requestId,
      documentId,
      kind: "reconcile",
      provider: this.selectedModel.critic.adapter.providerId,
      model: this.selectedModel.critic.model,
      inputHash,
    });
    const startedAt = performance.now();
    this.logger?.info(
      {
        modelRun: {
          requestId,
          provider: this.selectedModel.critic.adapter.providerId,
          model: this.selectedModel.critic.model,
          promptVersion: RECONCILE_PROMPT_VERSION,
          inputHash,
        },
      },
      "Reconciliation model run started",
    );
    try {
      const result = await this.selectedModel.critic.adapter.reconcile(
        {
          requestId,
          documentVersion: document.version,
          issue,
          currentBlock: context.currentBlock,
          nearbyBlocks: context.nearbyBlocks,
        },
        new AbortController().signal,
      );
      const latest = getDocument(this.database, documentId);
      if (latest.version !== document.version) {
        throw new ModelAdapterError(
          "MODEL_ABORTED",
          "The document changed before reconciliation completed.",
        );
      }
      const updated = persistReconciliationResult(this.database, {
        document: latest,
        issueId,
        result,
        context,
      });
      const latencyMs = Math.round(performance.now() - startedAt);
      finishModelRun(this.database, {
        id: runId,
        status: "completed",
        latencyMs,
      });
      this.broker.emit(documentId, {
        event:
          updated.status === "resolved"
            ? "issue_resolved"
            : updated.status === "invalidated"
              ? "issue_invalidated"
              : "issue_updated",
        data: { issue: updated, jobId: requestId },
      });
    } catch (error) {
      const modelError =
        error instanceof ModelAdapterError
          ? error
          : new ModelAdapterError(
              "MODEL_UNAVAILABLE",
              "Issue reconciliation failed.",
              { cause: error },
            );
      finishModelRun(this.database, {
        id: runId,
        status: modelError.code === "MODEL_ABORTED" ? "aborted" : "error",
        latencyMs: Math.round(performance.now() - startedAt),
        errorCode: modelError.code,
      });
      if (modelError.code === "MODEL_ABORTED") {
        const latest = getDocument(this.database, documentId);
        this.enqueue({
          documentId,
          documentVersion: latest.version,
          issueIds: [issueId],
          changedBlocks: [],
        });
      } else {
        this.broker.emit(documentId, {
          event: "critic_error",
          data: {
            code: modelError.code,
            message: modelError.message,
            jobId: requestId,
          },
        });
      }
    }
  }
}
