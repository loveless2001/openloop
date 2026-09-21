import type {
  EvaluationIntent,
  WritingCriterion,
  WritingEvaluationRun,
  WritingLanguageHint,
  WritingRubric,
} from "@openloop/shared";
import { useEffect, useRef, useState } from "react";

import type { EditorCriticSelection } from "./editor/critic-selection.js";
import {
  type EvaluationPreparationIdentity,
  sameEvaluationPreparationIdentity,
  useWritingEvaluation,
} from "./use-writing-evaluation.js";
import {
  blankRubric,
  starterRubric,
  WritingRubricEditor,
} from "./WritingRubricEditor.js";

export type WritingEvaluationTarget =
  | { kind: "document"; generation: number }
  | {
      kind: "selection";
      generation: number;
      selection: EditorCriticSelection;
    };

function evaluationTargetKey(target: WritingEvaluationTarget): string {
  return target.kind === "document"
    ? "document"
    : JSON.stringify(target.selection.blocks);
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
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

export function WritingEvaluationPanel(props: {
  currentVersion: number;
  documentId: string;
  draftChanged: boolean;
  editorGeneration: number;
  onPrepareVersion: (
    documentId: string,
    capturedGeneration: number,
    targetKind: WritingEvaluationTarget["kind"],
  ) => Promise<number>;
  target: WritingEvaluationTarget;
}) {
  const evaluation = useWritingEvaluation(props.documentId);
  const [selectedRubricId, setSelectedRubricId] = useState("");
  const [contextMode, setContextMode] = useState<"none" | "nearby">("none");
  const [languageHint, setLanguageHint] =
    useState<WritingLanguageHint>("unspecified");
  const [remoteConfirmed, setRemoteConfirmed] = useState(false);
  const [editing, setEditing] = useState<
    | { content: ReturnType<typeof blankRubric>; existing?: WritingRubric }
    | undefined
  >();

  useEffect(() => {
    if (!selectedRubricId && evaluation.rubrics[0]) {
      setSelectedRubricId(evaluation.rubrics[0].id);
    }
  }, [evaluation.rubrics, selectedRubricId]);

  const selectedRubric = evaluation.rubrics.find(
    (rubric) => rubric.id === selectedRubricId,
  );
  const targetKey = evaluationTargetKey(props.target);
  const currentInputRef = useRef<EvaluationPreparationIdentity | null>(null);
  currentInputRef.current = selectedRubric
    ? {
        contextMode,
        documentId: props.documentId,
        editorGeneration: props.editorGeneration,
        languageHint,
        rubricId: selectedRubric.id,
        rubricRevision: selectedRubric.revision,
        targetKey,
        targetKind: props.target.kind,
      }
    : null;
  const preparingRef = useRef(evaluation.preparing);
  preparingRef.current = evaluation.preparing;
  const previousGenerationRef = useRef(props.editorGeneration);

  useEffect(() => {
    const generationChanged =
      previousGenerationRef.current !== props.editorGeneration;
    previousGenerationRef.current = props.editorGeneration;
    evaluation.invalidatePrepared(
      generationChanged && preparingRef.current
        ? props.target.kind === "selection"
          ? "The draft changed after this selection was captured. Select the text again before preparing an evaluation."
          : "The draft changed during preparation. Review the latest text and prepare the preview again."
        : undefined,
    );
    setRemoteConfirmed(false);
  }, [
    contextMode,
    evaluation.invalidatePrepared,
    languageHint,
    props.documentId,
    props.editorGeneration,
    props.target.kind,
    selectedRubric?.id,
    selectedRubric?.revision,
    targetKey,
  ]);

  useEffect(() => {
    setRemoteConfirmed(false);
  }, [evaluation.prepared?.preview.inputHash]);
  const result = evaluation.resultRun;
  const currentRubricRevision = result
    ? evaluation.rubrics.find(
        (rubric) => rubric.id === result.snapshot.rubricSnapshot.id,
      )?.revision
    : undefined;
  const draftHistorical = Boolean(
    result &&
    (props.draftChanged || result.documentVersion !== props.currentVersion),
  );
  const rubricHistorical = Boolean(
    result &&
    currentRubricRevision !== undefined &&
    currentRubricRevision !== result.rubricRevision,
  );
  const requestedRun = evaluation.run;
  const running =
    requestedRun?.status === "queued" || requestedRun?.status === "running";
  const targetDescription =
    props.target.kind === "selection"
      ? `${props.target.selection.wordCount} selected ${
          props.target.selection.wordCount === 1 ? "word" : "words"
        }`
      : "Complete saved document";

  const prepare = async () => {
    if (!selectedRubric) return;
    const target = structuredClone(props.target);
    const editorGeneration =
      target.kind === "document" ? props.editorGeneration : target.generation;
    const identity = {
      contextMode,
      documentId: props.documentId,
      editorGeneration,
      languageHint,
      rubricId: selectedRubric.id,
      rubricRevision: selectedRubric.revision,
      targetKey: evaluationTargetKey(target),
      targetKind: target.kind,
    } as const;
    const isCurrent = () =>
      currentInputRef.current !== null &&
      sameEvaluationPreparationIdentity(currentInputRef.current, identity);
    await evaluation.prepare({
      identity,
      isCurrent,
      staleMessage:
        target.kind === "selection"
          ? "The draft changed after this selection was captured. Select the text again before preparing an evaluation."
          : "The draft changed during preparation. Review the latest text and prepare the preview again.",
      resolveIntent: async () => {
        const documentVersion = await props.onPrepareVersion(
          identity.documentId,
          identity.editorGeneration,
          identity.targetKind,
        );
        const intent: EvaluationIntent = {
          documentVersion,
          rubricId: identity.rubricId,
          rubricRevision: identity.rubricRevision,
          scope:
            target.kind === "document"
              ? { kind: "document" }
              : {
                  kind: "selection",
                  fragments: target.selection.blocks.map((block) => ({
                    ...block,
                    selectionStart: block.selectionStart ?? 0,
                    selectionEnd: block.selectionEnd ?? block.text.length,
                  })),
                  contextMode: identity.contextMode,
                },
          languageHint: identity.languageHint,
        };
        return intent;
      },
    });
  };

  return (
    <aside aria-label="Writing evaluation" className="evaluation-panel">
      <div className="evaluation-panel-heading">
        <p className="eyebrow">Rubric evaluation</p>
        <h2>Writing goals</h2>
        <span>{targetDescription}</span>
      </div>

      {editing ? (
        <WritingRubricEditor
          busy={evaluation.busy}
          existing={editing.existing}
          initial={editing.content}
          onCancel={() => setEditing(undefined)}
          onSave={async (content, existing) => {
            try {
              const saved = await evaluation.saveRubric(content, existing);
              setSelectedRubricId(saved.id);
              setEditing(undefined);
            } catch {
              // The hook keeps the editor open and exposes the actionable error.
            }
          }}
        />
      ) : (
        <>
          <section className="evaluation-controls">
            {evaluation.rubrics.length ? (
              <label>
                Rubric
                <select
                  onChange={(event) => setSelectedRubricId(event.target.value)}
                  value={selectedRubricId}
                >
                  {evaluation.rubrics.map((rubric) => (
                    <option key={rubric.id} value={rubric.id}>
                      {rubric.title} · revision {rubric.revision}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>No saved rubric yet.</p>
            )}
            <div className="rubric-picker-actions">
              <button
                onClick={() => setEditing({ content: starterRubric() })}
                type="button"
              >
                Use starter rubric
              </button>
              <button
                onClick={() => setEditing({ content: blankRubric() })}
                type="button"
              >
                Create blank rubric
              </button>
              {selectedRubric ? (
                <button
                  onClick={() =>
                    setEditing({
                      content: selectedRubric,
                      existing: selectedRubric,
                    })
                  }
                  type="button"
                >
                  Edit selected
                </button>
              ) : null}
            </div>
            {selectedRubric ? (
              <div className="rubric-summary">
                <p>
                  <strong>Purpose:</strong>{" "}
                  {selectedRubric.purpose || "Not specified"}
                </p>
                <p>
                  <strong>Audience:</strong>{" "}
                  {selectedRubric.audience || "Not specified"}
                </p>
                <p>{selectedRubric.criteria.length} independent criteria</p>
              </div>
            ) : null}
            {props.target.kind === "selection" ? (
              <fieldset className="context-choice">
                <legend>Selection context</legend>
                <label>
                  <input
                    checked={contextMode === "none"}
                    onChange={() => setContextMode("none")}
                    type="radio"
                  />
                  Selected text only
                </label>
                <label>
                  <input
                    checked={contextMode === "nearby"}
                    onChange={() => setContextMode("nearby")}
                    type="radio"
                  />
                  Include nearby context
                </label>
              </fieldset>
            ) : null}
            <label>
              Language hint
              <select
                onChange={(event) =>
                  setLanguageHint(event.target.value as WritingLanguageHint)
                }
                value={languageHint}
              >
                <option value="unspecified">Unspecified</option>
                <option value="en">English</option>
                <option value="vi">Vietnamese</option>
                <option value="other">Other</option>
              </select>
            </label>
            {languageHint !== "en" && languageHint !== "unspecified" ? (
              <p className="evaluation-warning">
                Non-English evaluation is experimental; the text is not
                translated.
              </p>
            ) : null}
            <div className="evaluator-status">
              <strong>
                {evaluation.evaluatorStatus?.label ?? "Checking evaluator…"}
              </strong>
              <span>
                {evaluation.evaluatorStatus?.requestedModel ?? "—"} ·
                destination {evaluation.evaluatorStatus?.destination ?? "—"}
              </span>
            </div>
            <button
              className="primary-button"
              disabled={!selectedRubric || evaluation.busy}
              onClick={() => {
                void prepare();
              }}
              type="button"
            >
              {evaluation.preparing ? "Preparing…" : "Prepare preview"}
            </button>
          </section>

          {evaluation.prepared ? (
            <section className="evaluation-preview">
              <div>
                <h3>Reviewed snapshot</h3>
                <span>
                  {evaluation.prepared.preview.byteCount.toLocaleString()} /{" "}
                  {evaluation.prepared.preview.byteLimit.toLocaleString()} UTF-8
                  bytes
                </span>
              </div>
              {evaluation.prepared.preview.snapshot.context.before ? (
                <details>
                  <summary>
                    Context before
                    {evaluation.prepared.preview.snapshot.context.beforeClipped
                      ? " · clipped"
                      : ""}
                  </summary>
                  <pre>
                    {evaluation.prepared.preview.snapshot.context.before}
                  </pre>
                </details>
              ) : null}
              <details open>
                <summary>Exact evaluation target</summary>
                <pre>{evaluation.prepared.preview.snapshot.targetText}</pre>
              </details>
              {evaluation.prepared.preview.snapshot.context.after ? (
                <details>
                  <summary>
                    Context after
                    {evaluation.prepared.preview.snapshot.context.afterClipped
                      ? " · clipped"
                      : ""}
                  </summary>
                  <pre>
                    {evaluation.prepared.preview.snapshot.context.after}
                  </pre>
                </details>
              ) : null}
              <details>
                <summary>Exact prepared request JSON</summary>
                <pre>
                  {JSON.stringify(
                    evaluation.prepared.preview.compiledRequest,
                    null,
                    2,
                  )}
                </pre>
              </details>
              <small>Input hash {evaluation.prepared.preview.inputHash}</small>
              {evaluation.evaluatorStatus?.mode === "remote" ? (
                <label className="remote-confirmation">
                  <input
                    checked={remoteConfirmed}
                    onChange={(event) =>
                      setRemoteConfirmed(event.target.checked)
                    }
                    type="checkbox"
                  />
                  Send this reviewed text, rubric, purpose, and audience to{" "}
                  {evaluation.evaluatorStatus.destination}
                </label>
              ) : null}
              <button
                className="primary-button"
                disabled={
                  evaluation.busy ||
                  running ||
                  evaluation.retrySubmission ||
                  (evaluation.evaluatorStatus?.mode === "remote" &&
                    !remoteConfirmed)
                }
                onClick={() => {
                  void evaluation.submitPrepared(
                    evaluation.evaluatorStatus?.mode !== "remote" ||
                      remoteConfirmed,
                  );
                }}
                type="button"
              >
                Evaluate
              </button>
            </section>
          ) : null}
        </>
      )}

      {evaluation.error ? (
        <p className="evaluation-error" role="alert">
          {evaluation.error}
        </p>
      ) : null}
      {evaluation.retrySubmission ? (
        <div className="rubric-picker-actions">
          <button
            className="primary-button"
            disabled={evaluation.busy}
            onClick={() => {
              void evaluation.retry();
            }}
            type="button"
          >
            Retry submission
          </button>
          <button
            disabled={evaluation.busy}
            onClick={evaluation.discardSubmissionRecovery}
            type="button"
          >
            Discard recovery and prepare a new run
          </button>
        </div>
      ) : null}
      {requestedRun ? (
        <section
          className="evaluation-run-state"
          data-status={requestedRun.status}
        >
          <strong>
            {running ? "Evaluating…" : statusLabel(requestedRun.status)}
          </strong>
          <span>
            {requestedRun.providerId} ·{" "}
            {requestedRun.returnedModel ?? requestedRun.requestedModel}
          </span>
          {requestedRun.failure ? <p>{requestedRun.failure.message}</p> : null}
          {running ? (
            <button
              disabled={evaluation.busy}
              onClick={() => {
                void evaluation.cancel();
              }}
              type="button"
            >
              Cancel
            </button>
          ) : null}
        </section>
      ) : null}

      {result ? (
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
              {result.snapshot.scope} · document version{" "}
              {result.documentVersion} · rubric revision {result.rubricRevision}
            </span>
            <span>
              {new Date(
                result.completedAt ?? result.updatedAt,
              ).toLocaleString()}{" "}
              · {result.providerId} ·{" "}
              {result.returnedModel ?? result.requestedModel}
            </span>
          </div>
          {result.snapshot.rubricSnapshot.criteria.map((criterion) => (
            <CriterionCard
              criterion={criterion}
              key={criterion.id}
              run={result}
            />
          ))}
          <details className="historical-snapshot">
            <summary>Saved target snapshot</summary>
            <pre>{result.snapshot.targetText}</pre>
          </details>
        </section>
      ) : null}
    </aside>
  );
}
