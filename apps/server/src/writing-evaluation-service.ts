import { randomUUID } from "node:crypto";

import {
  deriveWritingEvaluationResult,
  evaluationRequestIdentity,
  prepareWritingEvaluation,
} from "@openloop/core";
import {
  WritingEvaluatorError,
  type WritingEvaluator,
} from "@openloop/model-adapters";
import {
  type CompiledWritingEvaluationSchema,
  EvaluationSnapshotSchema,
  WritingEvaluationResultSchema,
  WritingEvaluationRunSchema,
  WritingEvaluationRunSummarySchema,
  WritingEvaluationFeedbackSchema,
  WritingEvaluationFeedbackInputSchema,
  WritingEvaluationExportSchema,
  type WritingEvaluationFeedbackInput,
  type CreateEvaluationRequest,
  type EvaluationIntent,
  type EvaluationPreview,
  type EvaluatorStatusResponse,
  type WritingEvaluationRun,
  type WritingEvaluationRunSummary,
} from "@openloop/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "./db/client.js";
import {
  writingEvaluationRuns,
  writingEvaluationFeedback,
} from "./db/schema.js";
import { getDocument } from "./documents.js";
import { getWritingRubric } from "./writing-rubrics.js";

type RunRow = typeof writingEvaluationRuns.$inferSelect;

export interface EvaluatorConfiguration {
  providerId: "mock" | "typesafe";
  requestedModel: string;
  endpointIdentity: string;
  mode: "mock" | "remote" | "disabled";
  configured: boolean;
  label: string;
  destination: string;
}

interface OperationalLogger {
  info: (metadata: Record<string, unknown>, message: string) => void;
  error: (metadata: Record<string, unknown>, message: string) => void;
}

interface QueuedEvaluation {
  runId: string;
  compiled: ReturnType<typeof CompiledWritingEvaluationSchema.parse>;
}

export class WritingEvaluationServiceError extends Error {
  constructor(
    readonly code:
      | "WRITING_EVALUATION_NOT_FOUND"
      | "EVALUATION_REQUEST_CONFLICT"
      | "EVALUATION_PREVIEW_STALE"
      | "EVALUATION_BUSY"
      | "EVALUATION_FEEDBACK_UNAVAILABLE"
      | "EVALUATION_CRITERION_NOT_FOUND"
      | "EVALUATOR_NOT_CONFIGURED",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function toSummary(row: RunRow): WritingEvaluationRunSummary {
  return WritingEvaluationRunSummarySchema.parse({
    id: row.id,
    documentId: row.documentId,
    requestId: row.requestId,
    documentVersion: row.documentVersion,
    rubricId: row.rubricId,
    rubricRevision: row.rubricRevision,
    inputHash: row.inputHash,
    providerId: row.providerId,
    requestedModel: row.requestedModel,
    ...(row.returnedModel ? { returnedModel: row.returnedModel } : {}),
    status: row.status,
    providerCalled: row.providerCalled === 1,
    ...(row.errorCode && row.errorMessage
      ? { failure: { code: row.errorCode, message: row.errorMessage } }
      : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    ...(row.completedAt
      ? { completedAt: new Date(row.completedAt).toISOString() }
      : {}),
  });
}

function toRun(row: RunRow): WritingEvaluationRun {
  return WritingEvaluationRunSchema.parse({
    ...toSummary(row),
    snapshot: EvaluationSnapshotSchema.parse(JSON.parse(row.snapshotJson)),
    compiledRequest: JSON.parse(row.compiledRequestJson),
    ...(row.resultJson
      ? {
          result: WritingEvaluationResultSchema.parse(
            JSON.parse(row.resultJson),
          ),
        }
      : {}),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(row.inputTokens === null || row.outputTokens === null
      ? {}
      : {
          usage: {
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
          },
        }),
  });
}

export class WritingEvaluationService {
  private readonly queue: QueuedEvaluation[] = [];
  private active?: { runId: string; controller: AbortController };
  private closed = false;

  constructor(
    private readonly database: Database,
    private readonly evaluator: WritingEvaluator | undefined,
    readonly configuration: EvaluatorConfiguration,
    private readonly logger: OperationalLogger,
  ) {
    const now = Date.now();
    this.database.orm
      .update(writingEvaluationRuns)
      .set({
        status: "interrupted",
        errorCode: "EVALUATION_INTERRUPTED",
        errorMessage: "Evaluation was interrupted by a server restart.",
        updatedAt: now,
        completedAt: now,
      })
      .where(inArray(writingEvaluationRuns.status, ["queued", "running"]))
      .run();
  }

  status(): EvaluatorStatusResponse {
    return {
      providerId: this.configuration.providerId,
      requestedModel: this.configuration.requestedModel,
      mode: this.configuration.mode,
      configured: this.configuration.configured,
      label: this.configuration.label,
      destination: this.configuration.destination,
      byteLimit: 24_000,
    };
  }

  prepare(documentId: string, intent: EvaluationIntent): EvaluationPreview {
    return prepareWritingEvaluation({
      document: getDocument(this.database, documentId),
      rubric: getWritingRubric(this.database, intent.rubricId),
      intent,
      providerId: this.configuration.providerId,
      endpointIdentity: this.configuration.endpointIdentity,
      requestedModel: this.configuration.requestedModel,
    }).preview;
  }

  submit(
    documentId: string,
    request: CreateEvaluationRequest,
  ): WritingEvaluationRun {
    const requestIdentityHash = evaluationRequestIdentity({
      documentId,
      request: {
        documentVersion: request.documentVersion,
        rubricId: request.rubricId,
        rubricRevision: request.rubricRevision,
        scope: request.scope,
        languageHint: request.languageHint,
        expectedInputHash: request.expectedInputHash,
      },
      providerId: this.configuration.providerId,
      endpointIdentity: this.configuration.endpointIdentity,
      requestedModel: this.configuration.requestedModel,
    });
    const existing = this.database.orm
      .select()
      .from(writingEvaluationRuns)
      .where(eq(writingEvaluationRuns.requestId, request.requestId))
      .get();
    if (existing) {
      if (existing.requestIdentityHash !== requestIdentityHash) {
        throw new WritingEvaluationServiceError(
          "EVALUATION_REQUEST_CONFLICT",
          "This request ID was already used for a different evaluation.",
        );
      }
      return toRun(existing);
    }
    const prepared = prepareWritingEvaluation({
      document: getDocument(this.database, documentId),
      rubric: getWritingRubric(this.database, request.rubricId),
      intent: request,
      providerId: this.configuration.providerId,
      endpointIdentity: this.configuration.endpointIdentity,
      requestedModel: this.configuration.requestedModel,
    });
    if (prepared.preview.inputHash !== request.expectedInputHash) {
      throw new WritingEvaluationServiceError(
        "EVALUATION_PREVIEW_STALE",
        "The reviewed evaluation preview is stale. Prepare it again before submitting.",
        {
          expectedInputHash: request.expectedInputHash,
          currentInputHash: prepared.preview.inputHash,
        },
      );
    }
    const compatible = prepared.compiled.criterionMapping.length > 0;
    if (
      compatible &&
      this.configuration.mode === "remote" &&
      !request.remoteSubmissionConfirmed
    ) {
      throw new WritingEvaluationServiceError(
        "EVALUATOR_NOT_CONFIGURED",
        "Confirm the reviewed remote submission before evaluating.",
      );
    }
    if (compatible && (!this.configuration.configured || !this.evaluator)) {
      throw new WritingEvaluationServiceError(
        "EVALUATOR_NOT_CONFIGURED",
        this.configuration.mode === "remote"
          ? "Set TYPESAFE_API_KEY to enable remote TypeSafe evaluation."
          : "Writing evaluation is disabled.",
      );
    }
    if (compatible && this.active && this.queue.length >= 2) {
      throw new WritingEvaluationServiceError(
        "EVALUATION_BUSY",
        "The evaluator already has one running and two queued evaluations.",
      );
    }

    const now = Date.now();
    const runId = randomUUID();
    const localResult = compatible
      ? undefined
      : deriveWritingEvaluationResult(prepared.compiled);
    this.database.orm
      .insert(writingEvaluationRuns)
      .values({
        id: runId,
        documentId,
        requestId: request.requestId,
        requestIdentityHash,
        documentVersion: request.documentVersion,
        rubricId: request.rubricId,
        rubricRevision: request.rubricRevision,
        inputHash: prepared.preview.inputHash,
        snapshotJson: JSON.stringify(prepared.compiled.snapshot),
        compiledRequestJson: JSON.stringify(prepared.compiled.request),
        compiledEvaluationJson: JSON.stringify(prepared.compiled),
        requestedModel: this.configuration.requestedModel,
        providerId: this.configuration.providerId,
        status: compatible ? "queued" : "completed",
        resultJson: localResult ? JSON.stringify(localResult) : null,
        policyVersion: prepared.compiled.snapshot.policyVersion,
        policyJson: JSON.stringify({
          assessabilityThreshold: 0.7,
          levelThreshold: 0.6,
        }),
        providerCalled: 0,
        inputTokens: compatible ? null : 0,
        outputTokens: compatible ? null : 0,
        createdAt: now,
        updatedAt: now,
        completedAt: compatible ? null : now,
      })
      .run();
    if (compatible) {
      this.queue.push({ runId, compiled: prepared.compiled });
      void this.drain();
    }
    return this.get(runId);
  }

  list(
    documentId: string,
    limit = 20,
    offset = 0,
  ): WritingEvaluationRunSummary[] {
    return this.database.orm
      .select()
      .from(writingEvaluationRuns)
      .where(eq(writingEvaluationRuns.documentId, documentId))
      .orderBy(
        desc(writingEvaluationRuns.createdAt),
        desc(writingEvaluationRuns.id),
      )
      .limit(limit)
      .offset(offset)
      .all()
      .map(toSummary);
  }

  get(runId: string): WritingEvaluationRun {
    const row = this.database.orm
      .select()
      .from(writingEvaluationRuns)
      .where(eq(writingEvaluationRuns.id, runId))
      .get();
    if (!row) {
      throw new WritingEvaluationServiceError(
        "WRITING_EVALUATION_NOT_FOUND",
        "Writing evaluation not found.",
      );
    }
    return toRun(row);
  }

  feedback(runId: string) {
    this.get(runId);
    return this.database.orm
      .select()
      .from(writingEvaluationFeedback)
      .where(eq(writingEvaluationFeedback.runId, runId))
      .all()
      .map((row) =>
        WritingEvaluationFeedbackSchema.parse({
          runId: row.runId,
          criterionId: row.criterionId,
          verdict: row.verdict,
          ...(row.preferredLevel === null
            ? {}
            : { preferredLevel: row.preferredLevel }),
          ...(row.comment === null ? {} : { comment: row.comment }),
          createdAt: new Date(row.createdAt).toISOString(),
          updatedAt: new Date(row.updatedAt).toISOString(),
        }),
      );
  }

  saveFeedback(
    runId: string,
    criterionId: string,
    input: WritingEvaluationFeedbackInput,
  ) {
    const validated = WritingEvaluationFeedbackInputSchema.parse(input);
    return this.database.sqlite.transaction(() => {
      const run = this.get(runId);
      if (run.status !== "completed") {
        throw new WritingEvaluationServiceError(
          "EVALUATION_FEEDBACK_UNAVAILABLE",
          "Feedback requires a completed evaluation.",
        );
      }
      if (
        !run.snapshot.rubricSnapshot.criteria.some(
          (criterion) => criterion.id === criterionId,
        )
      ) {
        throw new WritingEvaluationServiceError(
          "EVALUATION_CRITERION_NOT_FOUND",
          "This criterion is not in the evaluated rubric revision.",
        );
      }
      const now = Date.now();
      const values = {
        verdict: validated.verdict,
        preferredLevel: validated.preferredLevel ?? null,
        comment: validated.comment ?? null,
        updatedAt: now,
      };
      this.database.orm
        .insert(writingEvaluationFeedback)
        .values({ runId, criterionId, ...values, createdAt: now })
        .onConflictDoUpdate({
          target: [
            writingEvaluationFeedback.runId,
            writingEvaluationFeedback.criterionId,
          ],
          set: values,
        })
        .run();
      return this.feedback(runId).find(
        (entry) => entry.criterionId === criterionId,
      )!;
    })();
  }

  export(runId: string) {
    return this.database.sqlite.transaction(() => {
      const run = this.get(runId);
      const row = this.database.orm
        .select()
        .from(writingEvaluationRuns)
        .where(eq(writingEvaluationRuns.id, runId))
        .get()!;
      return WritingEvaluationExportSchema.parse({
        schemaVersion: "writing-evaluation-export.v1",
        exportedAt: new Date().toISOString(),
        sourceTextWarning:
          "Contains the evaluated source text, context, rubric, and author comments.",
        signalProvenance: {
          assessment:
            run.providerId === "mock" ? "mock_fixture" : "model_assessment",
          feedback: "author_feedback_not_verified_ground_truth",
        },
        run,
        policy: { ...JSON.parse(row.policyJson), version: row.policyVersion },
        feedback: this.feedback(runId),
      });
    })();
  }

  cancel(runId: string): WritingEvaluationRun {
    const run = this.get(runId);
    if (
      ["completed", "failed", "cancelled", "interrupted"].includes(run.status)
    ) {
      return run;
    }
    const queueIndex = this.queue.findIndex((queued) => queued.runId === runId);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    if (this.active?.runId === runId) this.active.controller.abort();
    const now = Date.now();
    this.database.orm
      .update(writingEvaluationRuns)
      .set({ status: "cancelled", updatedAt: now, completedAt: now })
      .where(
        and(
          eq(writingEvaluationRuns.id, runId),
          inArray(writingEvaluationRuns.status, ["queued", "running"]),
        ),
      )
      .run();
    return this.get(runId);
  }

  delete(runId: string): void {
    this.cancel(runId);
    this.database.orm
      .delete(writingEvaluationRuns)
      .where(eq(writingEvaluationRuns.id, runId))
      .run();
  }

  cancelAllForLocalDataDeletion(): void {
    this.active?.controller.abort();
    this.queue.splice(0);
    const now = Date.now();
    this.database.orm
      .update(writingEvaluationRuns)
      .set({ status: "cancelled", updatedAt: now, completedAt: now })
      .where(inArray(writingEvaluationRuns.status, ["queued", "running"]))
      .run();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.active?.controller.abort();
    this.queue.splice(0);
    const now = Date.now();
    this.database.orm
      .update(writingEvaluationRuns)
      .set({
        status: "interrupted",
        errorCode: "EVALUATION_INTERRUPTED",
        errorMessage: "Evaluation was interrupted by server shutdown.",
        updatedAt: now,
        completedAt: now,
      })
      .where(inArray(writingEvaluationRuns.status, ["queued", "running"]))
      .run();
  }

  private async drain(): Promise<void> {
    if (this.active || this.closed) return;
    const next = this.queue.shift();
    if (!next) return;
    const controller = new AbortController();
    this.active = { runId: next.runId, controller };
    const startedAt = Date.now();
    this.database.orm
      .update(writingEvaluationRuns)
      .set({ status: "running", providerCalled: 1, updatedAt: startedAt })
      .where(
        and(
          eq(writingEvaluationRuns.id, next.runId),
          eq(writingEvaluationRuns.status, "queued"),
        ),
      )
      .run();
    try {
      if (!this.evaluator) throw new Error("Writing evaluator is unavailable.");
      const response = await this.evaluator.evaluate(
        next.compiled,
        controller.signal,
      );
      const result = deriveWritingEvaluationResult(next.compiled, response);
      const completedAt = Date.now();
      this.database.orm
        .update(writingEvaluationRuns)
        .set({
          status: "completed",
          returnedModel: response.model,
          resultJson: JSON.stringify(result),
          durationMs: completedAt - startedAt,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          updatedAt: completedAt,
          completedAt,
        })
        .where(
          and(
            eq(writingEvaluationRuns.id, next.runId),
            eq(writingEvaluationRuns.status, "running"),
          ),
        )
        .run();
      this.logger.info(
        {
          runId: next.runId,
          provider: this.configuration.providerId,
          requestedModel: this.configuration.requestedModel,
          returnedModel: response.model,
          durationMs: completedAt - startedAt,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        },
        "Writing evaluation completed",
      );
    } catch (error) {
      const current = this.database.orm
        .select({ status: writingEvaluationRuns.status })
        .from(writingEvaluationRuns)
        .where(eq(writingEvaluationRuns.id, next.runId))
        .get();
      if (current?.status === "running") {
        const completedAt = Date.now();
        const failure =
          error instanceof WritingEvaluatorError
            ? { code: error.code, message: error.message }
            : {
                code: "EVALUATOR_INVALID_RESPONSE",
                message: "The evaluator did not return a valid assessment.",
              };
        this.database.orm
          .update(writingEvaluationRuns)
          .set({
            status: "failed",
            errorCode: failure.code,
            errorMessage: failure.message,
            durationMs: completedAt - startedAt,
            updatedAt: completedAt,
            completedAt,
          })
          .where(
            and(
              eq(writingEvaluationRuns.id, next.runId),
              eq(writingEvaluationRuns.status, "running"),
            ),
          )
          .run();
        this.logger.error(
          {
            runId: next.runId,
            provider: this.configuration.providerId,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorCode: failure.code,
          },
          "Writing evaluation failed",
        );
      }
    } finally {
      if (this.active?.runId === next.runId) this.active = undefined;
      void this.drain();
    }
  }
}
