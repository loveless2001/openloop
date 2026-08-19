import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { CompletionInteractionRequest } from "@openloop/shared";
import type {
  CompletionCandidateTraceV2,
  CompletionReplacementTraceV2,
  NaturalContinuationTraceV2,
  TrainingTraceV2,
} from "@openloop/training";

import { findWorkspaceRoot } from "./config/workspace.js";

type TracePayload<Trace> = Trace extends unknown
  ? Omit<Trace, "schemaVersion" | "recordedAt">
  : never;

export type CompletionTrainingTrace = TrainingTraceV2;

interface TrainingTraceWriterConfig {
  enabled: boolean;
  path: string;
  now?: () => Date;
}

export class TrainingTraceWriter {
  readonly enabled: boolean;
  readonly path: string;
  private readonly now: () => Date;
  private pending: Promise<void> = Promise.resolve();

  constructor(config: TrainingTraceWriterConfig) {
    this.enabled = config.enabled;
    this.path = isAbsolute(config.path)
      ? config.path
      : resolve(findWorkspaceRoot(), config.path);
    this.now = config.now ?? (() => new Date());
  }

  recordCandidate(
    trace: Omit<
      CompletionCandidateTraceV2,
      "type" | "schemaVersion" | "recordedAt" | "candidateId"
    >,
  ): Promise<void> {
    return this.append({
      type: "completion_candidate",
      candidateId: trace.requestId,
      ...trace,
    });
  }

  recordFeedback(event: CompletionInteractionRequest): Promise<void> {
    return this.append({
      type: "completion_feedback",
      requestId: event.requestId,
      candidateId: event.requestId,
      documentId: event.documentId,
      documentVersion: event.documentVersion,
      nodeId: event.nodeId,
      event: event.event,
      ...(event.acceptedCharacters === undefined
        ? {}
        : { acceptedCharacters: event.acceptedCharacters }),
    });
  }

  recordReplacement(
    trace: Omit<
      CompletionReplacementTraceV2,
      "type" | "schemaVersion" | "recordedAt"
    >,
  ): Promise<void> {
    return this.append({ type: "completion_replacement", ...trace });
  }

  recordNaturalContinuation(
    trace: Omit<
      NaturalContinuationTraceV2,
      "type" | "schemaVersion" | "recordedAt"
    >,
  ): Promise<void> {
    return this.append({ type: "natural_continuation", ...trace });
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private append(trace: TracePayload<CompletionTrainingTrace>): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    const record = {
      schemaVersion: 2,
      recordedAt: this.now().toISOString(),
      ...trace,
    };
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
      });
    this.pending = operation;
    return operation;
  }
}
