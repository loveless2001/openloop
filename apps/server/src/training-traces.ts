import { appendFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { CompletionInteractionRequest } from "@openloop/shared";

import { findWorkspaceRoot } from "./config/workspace.js";

export interface CompletionCandidateTrace {
  type: "completion_candidate";
  requestId: string;
  provider: string;
  model: string;
  documentTitle: string;
  prefix: string;
  suffix: string;
  headingPath: string[];
  suggestion: string;
  status: "completed" | "aborted" | "error";
  errorCode?: string;
}

export interface CompletionFeedbackTrace {
  type: "completion_feedback";
  requestId: string;
  event: CompletionInteractionRequest["event"];
  acceptedCharacters?: number;
}

export type CompletionTrainingTrace =
  CompletionCandidateTrace | CompletionFeedbackTrace;

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
    trace: Omit<CompletionCandidateTrace, "type">,
  ): Promise<void> {
    return this.append({ type: "completion_candidate", ...trace });
  }

  recordFeedback(event: CompletionInteractionRequest): Promise<void> {
    return this.append({
      type: "completion_feedback",
      requestId: event.requestId,
      event: event.event,
      ...(event.acceptedCharacters === undefined
        ? {}
        : { acceptedCharacters: event.acceptedCharacters }),
    });
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private append(trace: CompletionTrainingTrace): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    const record = {
      schemaVersion: 1,
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
