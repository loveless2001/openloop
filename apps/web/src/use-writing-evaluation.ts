import type {
  CreateEvaluationRequest,
  EvaluationIntent,
  EvaluationPreview,
  EvaluatorStatusResponse,
  WritingEvaluationRun,
  WritingRubric,
  WritingRubricContent,
} from "@openloop/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
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

export function useWritingEvaluation(documentId: string) {
  const [rubrics, setRubrics] = useState<WritingRubric[]>([]);
  const [evaluatorStatus, setEvaluatorStatus] =
    useState<EvaluatorStatusResponse | null>(null);
  const [preview, setPreview] = useState<EvaluationPreview | null>(null);
  const [run, setRun] = useState<WritingEvaluationRun | null>(null);
  const [resultRun, setResultRun] = useState<WritingEvaluationRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;

  const refreshRubrics = useCallback(async () => {
    const next = await loadWritingRubrics();
    if (documentIdRef.current === documentId) setRubrics(next);
    return next;
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setRun(null);
    setResultRun(null);
    setError(undefined);
    void Promise.all([
      loadEvaluatorStatus(),
      loadWritingRubrics(),
      listWritingEvaluations(documentId),
    ])
      .then(async ([status, nextRubrics, runs]) => {
        if (cancelled) return;
        setEvaluatorStatus(status);
        setRubrics(nextRubrics);
        const latest = runs[0];
        if (latest) {
          const detail = await loadWritingEvaluation(latest.id);
          if (!cancelled) {
            setRun(detail);
            if (detail.status === "completed") setResultRun(detail);
          }
        }
        const latestCompleted = runs.find(
          (candidate) => candidate.status === "completed",
        );
        if (latestCompleted && latestCompleted.id !== latest?.id) {
          const detail = await loadWritingEvaluation(latestCompleted.id);
          if (!cancelled) setResultRun(detail);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load writing evaluation.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!run || TERMINAL_STATUSES.has(run.status)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(() => void poll(), 1_500);
        return;
      }
      try {
        const next = await loadWritingEvaluation(run.id);
        if (cancelled || documentIdRef.current !== next.documentId) return;
        setRun(next);
        if (next.status === "completed") setResultRun(next);
        if (!TERMINAL_STATUSES.has(next.status)) {
          timer = window.setTimeout(() => void poll(), 1_000);
        }
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 2_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [run?.id, run?.status]);

  const saveRubric = useCallback(
    async (
      content: WritingRubricContent,
      existing?: WritingRubric,
    ): Promise<WritingRubric> => {
      setBusy(true);
      setError(undefined);
      try {
        const saved = existing
          ? await updateWritingRubric(existing.id, {
              ...content,
              baseRevision: existing.revision,
            })
          : await createWritingRubric(content);
        await refreshRubrics();
        setPreview(null);
        return saved;
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save rubric.",
        );
        throw saveError;
      } finally {
        setBusy(false);
      }
    },
    [refreshRubrics],
  );

  const prepare = useCallback(
    async (intent: EvaluationIntent) => {
      setBusy(true);
      setError(undefined);
      try {
        const next = await previewWritingEvaluation(documentId, intent);
        setPreview(next);
        return next;
      } catch (prepareError) {
        setPreview(null);
        setError(
          prepareError instanceof Error
            ? prepareError.message
            : "Could not prepare evaluation.",
        );
        throw prepareError;
      } finally {
        setBusy(false);
      }
    },
    [documentId],
  );

  const submit = useCallback(
    async (request: CreateEvaluationRequest) => {
      setBusy(true);
      setError(undefined);
      try {
        const next = await submitWritingEvaluation(documentId, request);
        setRun(next);
        return next;
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Could not start evaluation.",
        );
        throw submitError;
      } finally {
        setBusy(false);
      }
    },
    [documentId],
  );

  const cancel = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    try {
      setRun(await cancelWritingEvaluation(run.id));
    } finally {
      setBusy(false);
    }
  }, [run]);

  return {
    busy,
    cancel,
    error,
    evaluatorStatus,
    invalidatePreview: () => setPreview(null),
    prepare,
    preview,
    rubrics,
    run,
    resultRun,
    saveRubric,
    submit,
  };
}
