import type {
  WritingCriterion,
  WritingEvaluationFeedback,
  WritingEvaluationFeedbackInput,
  WritingEvaluationRun,
  WritingEvaluationRunSummary,
  WritingRubric,
} from "@openloop/shared";
import { useEffect, useState } from "react";

import {
  exportWritingEvaluation,
  listWritingEvaluations,
  loadEvaluationFeedback,
  loadWritingEvaluation,
  saveEvaluationFeedback,
} from "./api.js";

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function FeedbackForm(props: {
  runId: string;
  criterion: WritingCriterion;
  saved?: WritingEvaluationFeedback;
}) {
  const [verdict, setVerdict] = useState(props.saved?.verdict ?? "");
  const [preferredLevel, setPreferredLevel] = useState(
    props.saved?.preferredLevel?.toString() ?? "",
  );
  const [comment, setComment] = useState(props.saved?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <form
      className="evaluation-feedback"
      aria-label={`Feedback for ${props.criterion.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!verdict || busy) return;
        setBusy(true);
        setMessage("");
        void saveEvaluationFeedback(props.runId, props.criterion.id, {
          verdict: verdict as WritingEvaluationFeedbackInput["verdict"],
          ...(preferredLevel === ""
            ? {}
            : { preferredLevel: Number(preferredLevel) }),
          ...(comment ? { comment } : {}),
        })
          .then(() => setMessage("Feedback saved."))
          .catch(() =>
            setMessage(
              "Could not save feedback. Your entries are still here; try again.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <fieldset disabled={busy}>
        <legend>Your feedback</legend>
        <label>
          Verdict
          <select
            value={verdict}
            onChange={(event) => {
              setVerdict(event.target.value as typeof verdict);
              setMessage("");
            }}
            required
          >
            <option value="" disabled>
              Choose a verdict
            </option>
            <option value="agree">Agree</option>
            <option value="disagree">Disagree</option>
            <option value="unclear_rubric">Unclear rubric</option>
            <option value="missing_context">Missing context</option>
            <option value="not_applicable">Not applicable</option>
            <option value="unsure">Unsure</option>
          </select>
        </label>
        <label>
          Preferred level (optional)
          <select
            value={preferredLevel}
            onChange={(event) => {
              setPreferredLevel(event.target.value);
              setMessage("");
            }}
          >
            <option value="">No preferred level</option>
            {props.criterion.levels.map((level, index) => (
              <option value={index} key={index}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Comment (optional)
          <textarea
            value={comment}
            maxLength={2_000}
            onChange={(event) => {
              setComment(event.target.value);
              setMessage("");
            }}
          />
        </label>
        <button type="submit" disabled={!verdict}>
          {busy ? "Saving…" : "Save feedback"}
        </button>
      </fieldset>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}

function SavedEvaluation(props: {
  run: WritingEvaluationRun;
  rubrics: WritingRubric[];
  currentVersion: number;
  draftChanged: boolean;
}) {
  const { run } = props;
  const [feedback, setFeedback] = useState<WritingEvaluationFeedback[] | null>(
    null,
  );
  const [feedbackError, setFeedbackError] = useState(false);
  const [feedbackAttempt, setFeedbackAttempt] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setFeedbackError(false);
    void loadEvaluationFeedback(run.id)
      .then((entries) => {
        if (!cancelled) setFeedback(entries);
      })
      .catch(() => {
        if (!cancelled) setFeedbackError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [run.id, feedbackAttempt]);
  const currentRevision = props.rubrics.find(
    (rubric) => rubric.id === run.rubricId,
  )?.revision;
  const draftHistorical =
    props.draftChanged || run.documentVersion !== props.currentVersion;
  const rubricHistorical =
    currentRevision !== undefined && currentRevision !== run.rubricRevision;

  return (
    <section className="evaluation-results">
      <div className="evaluation-result-provenance">
        <strong>
          {draftHistorical && rubricHistorical
            ? "Draft and rubric changed since evaluation"
            : draftHistorical
              ? "Draft changed since evaluation"
              : rubricHistorical
                ? "Rubric changed"
                : "Current snapshot"}
        </strong>
        <span>
          {run.snapshot.scope} · document version {run.documentVersion} · rubric
          revision {run.rubricRevision}
        </span>
        <span>
          {new Date(run.completedAt ?? run.updatedAt).toLocaleString()} ·{" "}
          {run.providerId === "mock" ? "Mock — UI test only" : "TypeSafe"} ·{" "}
          {run.returnedModel ?? run.requestedModel}
        </span>
        <span>
          {statusLabel(run.status)} · {run.snapshot.rubricSnapshot.title}
        </span>
        {run.failure ? <p role="alert">{run.failure.message}</p> : null}
      </div>
      <details className="historical-snapshot">
        <summary>Saved target snapshot</summary>
        <pre>{run.snapshot.targetText}</pre>
        {run.snapshot.context.before ? (
          <>
            <h4>
              Context before
              {run.snapshot.context.beforeClipped ? " · clipped" : ""}
            </h4>
            <pre>{run.snapshot.context.before}</pre>
          </>
        ) : null}
        {run.snapshot.context.after ? (
          <>
            <h4>
              Context after
              {run.snapshot.context.afterClipped ? " · clipped" : ""}
            </h4>
            <pre>{run.snapshot.context.after}</pre>
          </>
        ) : null}
        <p>Purpose: {run.snapshot.rubricSnapshot.purpose || "Not specified"}</p>
        <p>
          Audience: {run.snapshot.rubricSnapshot.audience || "Not specified"}
        </p>
        <p>Language: {run.snapshot.languageHint}</p>
        <small>Input hash {run.inputHash}</small>
      </details>
      {feedbackError ? (
        <p role="alert">
          Could not load saved feedback.{" "}
          <button
            type="button"
            onClick={() => setFeedbackAttempt((attempt) => attempt + 1)}
          >
            Retry feedback
          </button>
        </p>
      ) : null}
      {run.result ? (
        <p className="evaluation-feedback-note">
          Feedback records your judgment against this saved rubric. It does not
          change the assessment or train a model.
        </p>
      ) : null}
      {run.snapshot.rubricSnapshot.criteria.map((criterion) => (
        <div key={criterion.id}>
          <CriterionCard criterion={criterion} run={run} />
          {run.status === "completed" && feedback ? (
            <FeedbackForm
              runId={run.id}
              criterion={criterion}
              saved={feedback.find(
                (entry) => entry.criterionId === criterion.id,
              )}
            />
          ) : null}
        </div>
      ))}
      <div className="evaluation-export">
        <p>
          Export contains the evaluated source text, context, rubric, and saved
          author comments.
        </p>
        <button
          type="button"
          disabled={exportBusy}
          onClick={() => {
            setExportBusy(true);
            setExportError("");
            void exportWritingEvaluation(run.id)
              .then((record) => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(record, null, 2) + "\n"], {
                    type: "application/json",
                  }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `evaluation-${run.id}.json`;
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
              })
              .catch(() =>
                setExportError("Could not export this evaluation. Try again."),
              )
              .finally(() => setExportBusy(false));
          }}
        >
          {exportBusy ? "Exporting…" : "Export evaluation JSON"}
        </button>
        {exportError ? <p role="alert">{exportError}</p> : null}
      </div>
    </section>
  );
}

export function WritingEvaluationResearch(props: {
  documentId: string;
  latestRun: WritingEvaluationRun | null;
  resultRun: WritingEvaluationRun | null;
  rubrics: WritingRubric[];
  currentVersion: number;
  draftChanged: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [runs, setRuns] = useState<WritingEvaluationRunSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRun, setSelectedRun] = useState<WritingEvaluationRun | null>(
    null,
  );
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setListBusy(true);
    setListError(false);
    void listWritingEvaluations(props.documentId, offset)
      .then((next) => {
        if (!cancelled) setRuns(next);
      })
      .catch(() => {
        if (!cancelled) setListError(true);
      })
      .finally(() => {
        if (!cancelled) setListBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    props.documentId,
    props.latestRun?.id,
    props.latestRun?.status,
    offset,
    attempt,
  ]);
  useEffect(() => {
    let cancelled = false;
    setDetailError(false);
    if (selectedId)
      void loadWritingEvaluation(selectedId)
        .then((run) => {
          if (!cancelled && run.documentId === props.documentId)
            setSelectedRun(run);
        })
        .catch(() => {
          if (!cancelled) setDetailError(true);
        });
    return () => {
      cancelled = true;
    };
  }, [selectedId, props.documentId, props.latestRun?.status, attempt]);
  const viewed = selectedId
    ? selectedRun?.id === selectedId
      ? selectedRun
      : null
    : props.resultRun;
  return (
    <>
      <section className="evaluation-history" aria-label="Evaluation history">
        <h3>Evaluation history</h3>
        <button
          type="button"
          aria-pressed={!selectedId}
          onClick={() => setSelectedId("")}
        >
          Latest result
        </button>
        {listError ? (
          <p role="alert">
            Could not load history.{" "}
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry history
            </button>
          </p>
        ) : null}
        {listBusy ? (
          <p role="status">Loading history…</p>
        ) : (
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === run.id}
                  onClick={() => setSelectedId(run.id)}
                >
                  {new Date(run.createdAt).toLocaleString()} ·{" "}
                  {statusLabel(run.status)} · document v{run.documentVersion} ·
                  rubric r{run.rubricRevision} · {run.providerId}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!listBusy && !listError && !runs.length ? (
          <p>No evaluations on this page.</p>
        ) : null}
        <div className="rubric-picker-actions">
          <button
            type="button"
            disabled={listBusy || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 20))}
          >
            Newer runs
          </button>
          <button
            type="button"
            disabled={listBusy || listError || runs.length < 20}
            onClick={() => setOffset((value) => value + 20)}
          >
            Older runs
          </button>
        </div>
      </section>
      {selectedId && !viewed ? (
        <p role={detailError ? "alert" : "status"}>
          {detailError
            ? "Could not load this saved run."
            : "Loading saved run…"}
          {detailError ? (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry saved run
            </button>
          ) : null}
        </p>
      ) : null}
      {viewed ? (
        <SavedEvaluation
          key={viewed.id}
          run={viewed}
          rubrics={props.rubrics}
          currentVersion={props.currentVersion}
          draftChanged={props.draftChanged}
        />
      ) : null}
    </>
  );
}
function CriterionCard(props: {
  criterion: WritingCriterion;
  run: WritingEvaluationRun;
}) {
  const assessment = props.run.result?.criteria.find(
    (entry) => entry.criterionId === props.criterion.id,
  );
  if (!assessment) return null;
  const primary =
    assessment.primaryLevel === undefined
      ? undefined
      : props.criterion.levels[assessment.primaryLevel];
  const headline =
    assessment.status === "assessed"
      ? assessment.mixed
        ? "Mixed assessment"
        : primary?.label
      : assessment.status === "needs_context"
        ? "Cannot assess with this context"
        : assessment.status === "not_applicable"
          ? "Not applicable"
          : assessment.status === "uncertain_assessability"
            ? "Assessability uncertain"
            : "Not available for this scope";

  return (
    <article className="evaluation-criterion-card">
      <div>
        <h3>{props.criterion.name}</h3>
        <strong>{headline}</strong>
      </div>
      <p>{props.criterion.question}</p>
      {primary && !assessment.mixed ? (
        <p className="saved-level-description">
          <span>Saved rubric level</span>
          {primary.description}
        </p>
      ) : null}
      <details>
        <summary>Details</summary>
        <ol className="evaluation-levels">
          {props.criterion.levels.map((level, index) => (
            <li key={level.label}>
              <span>
                <strong>{level.label}</strong>
                <small>{level.description}</small>
              </span>
              <output>
                {assessment.score?.probabilities[
                  String(index) as "0" | "1" | "2"
                ].toFixed(2) ?? "—"}
              </output>
            </li>
          ))}
        </ol>
        {assessment.score ? (
          <p>
            Scale position {assessment.score.score.toFixed(2)} on the rubric's
            0–2 scale · provider confidence{" "}
            {assessment.score.confidence.toFixed(2)}
            {assessment.status !== "assessed"
              ? " · score not used for the assessment"
              : ""}
          </p>
        ) : null}
        {assessment.assessability ? (
          <p>
            Assessability: {statusLabel(assessment.assessability.choice)} (
            {assessment.assessability.probabilities[
              assessment.assessability.choice
            ].toFixed(2)}
            )
          </p>
        ) : null}
        <small>
          Provider confidence describes the returned distribution; it is not a
          demonstrated probability that the writing judgment is correct.
        </small>
      </details>
    </article>
  );
}
