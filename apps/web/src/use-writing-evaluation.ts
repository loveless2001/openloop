import type {
  CreateEvaluationRequest,
  EvaluationIntent,
  EvaluationPreview,
  EvaluatorStatusResponse,
  WritingEvaluationRun,
  WritingLanguageHint,
  WritingRubric,
  WritingRubricContent,
} from "@openloop/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiClientError,
  cancelWritingEvaluation,
  createWritingRubric,
  listWritingEvaluations,
  loadEvaluatorStatus,
  loadWritingEvaluation,
  loadWritingRubrics,
  previewWritingEvaluation,
  submitWritingEvaluation,
  updateWritingRubric,
} from "./api.js";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export interface EvaluationPreparationIdentity {
  contextMode: "none" | "nearby";
  documentId: string;
  editorGeneration: number;
  languageHint: WritingLanguageHint;
  rubricId: string;
  rubricRevision: number;
  targetKey: string;
  targetKind: "document" | "selection";
}

export interface PreparedWritingEvaluation {
  identity: EvaluationPreparationIdentity;
  intent: EvaluationIntent;
  preview: EvaluationPreview;
}

export function sameEvaluationPreparationIdentity(
  left: EvaluationPreparationIdentity,
  right: EvaluationPreparationIdentity,
): boolean {
  return (
    left.contextMode === right.contextMode &&
    left.documentId === right.documentId &&
    left.editorGeneration === right.editorGeneration &&
    left.languageHint === right.languageHint &&
    left.rubricId === right.rubricId &&
    left.rubricRevision === right.rubricRevision &&
    left.targetKey === right.targetKey &&
    left.targetKind === right.targetKind
  );
}

interface RetriableSubmission {
  documentId: string;
  request: CreateEvaluationRequest;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function preparationMessage(
  error: unknown,
  identity: EvaluationPreparationIdentity,
): string {
  if (error instanceof ApiClientError) {
    if (error.code === "DOCUMENT_VERSION_CONFLICT") {
      return identity.targetKind === "selection"
        ? "The saved draft changed after this selection was captured. Select the text again, then prepare a new preview."
        : "The saved draft changed during preparation. Review the latest draft and prepare the preview again.";
    }
    if (error.code === "RUBRIC_VERSION_CONFLICT") {
      return "The rubric changed during preparation. Review its latest revision and prepare the preview again.";
    }
  }
  if (error instanceof TypeError) {
    return "The preview request could not reach the local server. Check the connection and retry preparation; the draft remains editable.";
  }
  return message(
    error,
    "Could not prepare the evaluation. Check the connection and try again.",
  );
}

export function useWritingEvaluation(documentId: string) {
  const [rubrics, setRubrics] = useState<WritingRubric[]>([]);
  const [evaluatorStatus, setEvaluatorStatus] =
    useState<EvaluatorStatusResponse | null>(null);
  const [prepared, setPrepared] = useState<PreparedWritingEvaluation | null>(
    null,
  );
  const [run, setRun] = useState<WritingEvaluationRun | null>(null);
  const [resultRun, setResultRun] = useState<WritingEvaluationRun | null>(null);
  const [retrySubmission, setRetrySubmission] =
    useState<RetriableSubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string>();

  const documentIdRef = useRef(documentId);
  const documentEpochRef = useRef(0);
  const preparationEpochRef = useRef(0);
  const preparationAbortRef = useRef<AbortController | undefined>(undefined);
  const submissionEpochRef = useRef(0);
  const submissionAbortRef = useRef<AbortController | undefined>(undefined);
  const trackingEpochRef = useRef(0);
  const trackedRunIdRef = useRef<string | undefined>(undefined);
  const runRef = useRef<WritingEvaluationRun | null>(null);
  const operationCountRef = useRef(0);

  if (documentIdRef.current !== documentId) {
    documentIdRef.current = documentId;
    documentEpochRef.current += 1;
    preparationEpochRef.current += 1;
    submissionEpochRef.current += 1;
    trackingEpochRef.current += 1;
    trackedRunIdRef.current = undefined;
    runRef.current = null;
  }

  const beginOperation = useCallback(() => {
    operationCountRef.current += 1;
    setBusy(true);
  }, []);

  const endOperation = useCallback(() => {
    operationCountRef.current = Math.max(0, operationCountRef.current - 1);
    setBusy(operationCountRef.current > 0);
  }, []);

  const invalidatePrepared = useCallback((reason?: string) => {
    preparationEpochRef.current += 1;
    preparationAbortRef.current?.abort();
    preparationAbortRef.current = undefined;
    setPreparing(false);
    setPrepared(null);
    if (reason) setError(reason);
  }, []);

  const ingestRun = useCallback(
    (
      next: WritingEvaluationRun,
      options: {
        displayResult?: boolean;
        expectedRunId?: string;
        track?: boolean;
        trackingEpoch: number;
      },
    ): boolean => {
      if (
        documentIdRef.current !== next.documentId ||
        trackingEpochRef.current !== options.trackingEpoch ||
        (options.expectedRunId !== undefined &&
          trackedRunIdRef.current !== options.expectedRunId)
      ) {
        return false;
      }

      if (options.track) {
        const current = runRef.current;
        if (
          current?.id === next.id &&
          TERMINAL_STATUSES.has(current.status) &&
          !TERMINAL_STATUSES.has(next.status)
        ) {
          return false;
        }
        trackedRunIdRef.current = next.id;
        runRef.current = next;
        setRun(next);
      }

      if (
        next.status === "completed" &&
        (options.track || options.displayResult)
      ) {
        setResultRun((current) => {
          if (!current || current.id === next.id) return next;
          return Date.parse(next.createdAt) >= Date.parse(current.createdAt)
            ? next
            : current;
        });
      }
      return true;
    },
    [],
  );

  const refreshRubrics = useCallback(async () => {
    const requestedDocumentId = documentId;
    const next = await loadWritingRubrics();
    if (documentIdRef.current === requestedDocumentId) setRubrics(next);
    return next;
  }, [documentId]);

  useEffect(() => {
    const requestedDocumentId = documentId;
    const documentEpoch = documentEpochRef.current;
    const trackingEpoch = ++trackingEpochRef.current;
    let cancelled = false;
    preparationAbortRef.current?.abort();
    submissionAbortRef.current?.abort();
    setPrepared(null);
    setRetrySubmission(null);
    setRun(null);
    runRef.current = null;
    trackedRunIdRef.current = undefined;
    setResultRun(null);
    setError(undefined);

    const current = () =>
      !cancelled &&
      documentIdRef.current === requestedDocumentId &&
      documentEpochRef.current === documentEpoch &&
      trackingEpochRef.current === trackingEpoch;

    void Promise.all([
      loadEvaluatorStatus(),
      loadWritingRubrics(),
      listWritingEvaluations(requestedDocumentId),
    ])
      .then(async ([status, nextRubrics, runs]) => {
        if (!current()) return;
        setEvaluatorStatus(status);
        setRubrics(nextRubrics);
        const latest = runs[0];
        if (latest) {
          const detail = await loadWritingEvaluation(latest.id);
          if (!current()) return;
          trackedRunIdRef.current = detail.id;
          ingestRun(detail, { track: true, trackingEpoch });
        }
        const latestCompleted = runs.find(
          (candidate) => candidate.status === "completed",
        );
        if (latestCompleted && latestCompleted.id !== latest?.id) {
          const detail = await loadWritingEvaluation(latestCompleted.id);
          if (!current()) return;
          ingestRun(detail, { displayResult: true, trackingEpoch });
        }
      })
      .catch((loadError: unknown) => {
        if (current()) {
          setError(message(loadError, "Could not load writing evaluation."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, ingestRun]);

  useEffect(() => {
    if (!run || TERMINAL_STATUSES.has(run.status)) return;
    const expectedRunId = run.id;
    const trackingEpoch = trackingEpochRef.current;
    let cancelled = false;
    let timer: number | undefined;
    const current = () =>
      !cancelled &&
      documentIdRef.current === run.documentId &&
      trackingEpochRef.current === trackingEpoch &&
      trackedRunIdRef.current === expectedRunId;
    const poll = async () => {
      if (!current()) return;
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(() => void poll(), 1_500);
        return;
      }
      try {
        const next = await loadWritingEvaluation(expectedRunId);
        if (
          !ingestRun(next, {
            expectedRunId,
            track: true,
            trackingEpoch,
          })
        ) {
          return;
        }
        if (!TERMINAL_STATUSES.has(next.status) && current()) {
          timer = window.setTimeout(() => void poll(), 1_000);
        }
      } catch {
        if (current()) timer = window.setTimeout(() => void poll(), 2_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [ingestRun, run]);

  const saveRubric = useCallback(
    async (
      content: WritingRubricContent,
      existing?: WritingRubric,
    ): Promise<WritingRubric> => {
      beginOperation();
      setError(undefined);
      try {
        const saved = existing
          ? await updateWritingRubric(existing.id, {
              ...content,
              baseRevision: existing.revision,
            })
          : await createWritingRubric(content);
        await refreshRubrics();
        invalidatePrepared();
        return saved;
      } catch (saveError) {
        setError(message(saveError, "Could not save rubric."));
        throw saveError;
      } finally {
        endOperation();
      }
    },
    [beginOperation, endOperation, invalidatePrepared, refreshRubrics],
  );

  const prepare = useCallback(
    async (input: {
      identity: EvaluationPreparationIdentity;
      isCurrent: () => boolean;
      resolveIntent: () => Promise<EvaluationIntent>;
      staleMessage: string;
    }): Promise<PreparedWritingEvaluation | undefined> => {
      const preparationEpoch = ++preparationEpochRef.current;
      preparationAbortRef.current?.abort();
      const controller = new AbortController();
      preparationAbortRef.current = controller;
      setPrepared(null);
      setError(undefined);
      setPreparing(true);
      beginOperation();
      const owned = () =>
        preparationEpochRef.current === preparationEpoch &&
        documentIdRef.current === input.identity.documentId;
      const current = () => owned() && input.isCurrent();
      const stopIfObsolete = () => {
        if (current()) return false;
        if (owned()) setError(input.staleMessage);
        return true;
      };
      try {
        if (stopIfObsolete()) return undefined;
        const intent = await input.resolveIntent();
        if (stopIfObsolete()) return undefined;
        const preview = await previewWritingEvaluation(
          input.identity.documentId,
          intent,
          controller.signal,
        );
        if (stopIfObsolete()) return undefined;
        const next = {
          identity: input.identity,
          intent: structuredClone(intent),
          preview,
        };
        setPrepared(next);
        return next;
      } catch (prepareError) {
        if (!owned() || controller.signal.aborted) return undefined;
        setPrepared(null);
        setError(preparationMessage(prepareError, input.identity));
        return undefined;
      } finally {
        if (preparationAbortRef.current === controller) {
          preparationAbortRef.current = undefined;
        }
        if (preparationEpochRef.current === preparationEpoch) {
          setPreparing(false);
        }
        endOperation();
      }
    },
    [beginOperation, endOperation],
  );

  const sendSubmission = useCallback(
    async (submission: RetriableSubmission): Promise<void> => {
      const submissionEpoch = ++submissionEpochRef.current;
      submissionAbortRef.current?.abort();
      const controller = new AbortController();
      submissionAbortRef.current = controller;
      const trackingEpoch = ++trackingEpochRef.current;
      trackedRunIdRef.current = undefined;
      runRef.current = null;
      setRun(null);
      setError(undefined);
      beginOperation();
      const current = () =>
        submissionEpochRef.current === submissionEpoch &&
        documentIdRef.current === submission.documentId;
      try {
        const next = await submitWritingEvaluation(
          submission.documentId,
          submission.request,
          controller.signal,
        );
        if (!current() || trackingEpochRef.current !== trackingEpoch) return;
        trackedRunIdRef.current = next.id;
        ingestRun(next, { track: true, trackingEpoch });
        setRetrySubmission(null);
        invalidatePrepared();
      } catch (submitError) {
        if (!current() || controller.signal.aborted) return;
        if (!(submitError instanceof ApiClientError)) {
          setRetrySubmission(submission);
          setError(
            "The submission may have been accepted, but its response was not received. Retry submission to recover the same run without starting another evaluation.",
          );
        } else {
          setRetrySubmission(null);
          setError(message(submitError, "Could not start evaluation."));
        }
      } finally {
        if (submissionAbortRef.current === controller) {
          submissionAbortRef.current = undefined;
        }
        endOperation();
      }
    },
    [beginOperation, endOperation, ingestRun, invalidatePrepared],
  );

  const submitPrepared = useCallback(
    async (remoteSubmissionConfirmed: boolean): Promise<void> => {
      if (!prepared || prepared.identity.documentId !== documentIdRef.current) {
        setError(
          "Prepare and review the current evaluation before submitting.",
        );
        return;
      }
      const submission: RetriableSubmission = {
        documentId: prepared.identity.documentId,
        request: structuredClone({
          ...prepared.intent,
          requestId: crypto.randomUUID(),
          expectedInputHash: prepared.preview.inputHash,
          remoteSubmissionConfirmed,
        }),
      };
      setRetrySubmission(null);
      await sendSubmission(submission);
    },
    [prepared, sendSubmission],
  );

  const retry = useCallback(async (): Promise<void> => {
    if (!retrySubmission) return;
    await sendSubmission(retrySubmission);
  }, [retrySubmission, sendSubmission]);

  const discardSubmissionRecovery = useCallback(() => {
    setRetrySubmission(null);
    setError(undefined);
    invalidatePrepared();
  }, [invalidatePrepared]);

  const cancel = useCallback(async (): Promise<void> => {
    const requestedRun = runRef.current;
    if (!requestedRun) return;
    const trackingEpoch = trackingEpochRef.current;
    beginOperation();
    setError(undefined);
    try {
      const next = await cancelWritingEvaluation(requestedRun.id);
      ingestRun(next, {
        expectedRunId: requestedRun.id,
        track: true,
        trackingEpoch,
      });
    } catch (cancelError) {
      if (
        documentIdRef.current === requestedRun.documentId &&
        trackingEpochRef.current === trackingEpoch &&
        trackedRunIdRef.current === requestedRun.id
      ) {
        setError(message(cancelError, "Could not cancel the evaluation."));
      }
    } finally {
      endOperation();
    }
  }, [beginOperation, endOperation, ingestRun]);

  const activePrepared =
    prepared?.identity.documentId === documentId ? prepared : null;
  const activeRun = run?.documentId === documentId ? run : null;
  const activeResultRun =
    resultRun?.documentId === documentId ? resultRun : null;
  const hasActiveRetry = retrySubmission?.documentId === documentId;

  return {
    busy,
    cancel,
    discardSubmissionRecovery,
    error,
    evaluatorStatus,
    invalidatePrepared,
    prepare,
    preparing,
    prepared: activePrepared,
    retry,
    retrySubmission: hasActiveRetry,
    rubrics,
    run: activeRun,
    resultRun: activeResultRun,
    saveRubric,
    submitPrepared,
  };
}
