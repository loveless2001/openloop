import {
  ApiErrorSchema,
  CriticJobResponseSchema,
  CriticAgentStatusResponseSchema,
  DocumentBundleSchema,
  DocumentRecordSchema,
  DeleteLocalDataResponseSchema,
  ExportReviewResponseSchema,
  IssueActionResponseSchema,
  IssueChatResponseSchema,
  IssueChatSendResponseSchema,
  IssueEventsResponseSchema,
  IssueListResponseSchema,
  ModelStatusResponseSchema,
  ReconcileJobResponseSchema,
  ResurfaceResponseSchema,
  SaveDocumentResponseSchema,
  type CriticJobRequest,
  type CriticAgentStatusResponse,
  type DocumentRecord,
  type IssueActionRequest,
  type IssueChatSendRequest,
  type IssueRecord,
  type EditorChangeBatch,
  type ExportReviewResponse,
  type JsonValue,
  type ModelStatusResponse,
  type ReconcileRequest,
  type ResurfaceRequest,
  CreateWritingRubricRequestSchema,
  EvaluationPreviewSchema,
  EvaluatorStatusResponseSchema,
  WritingEvaluationListResponseSchema,
  WritingEvaluationRunSchema,
  WritingEvaluationFeedbackSchema,
  WritingEvaluationFeedbackListSchema,
  WritingEvaluationExportSchema,
  type WritingEvaluationFeedbackInput,
  WritingRubricListResponseSchema,
  WritingRubricSchema,
  type CreateEvaluationRequest,
  type EvaluationIntent,
  type EvaluationPreview,
  type EvaluatorStatusResponse,
  type WritingEvaluationRun,
  type WritingEvaluationRunSummary,
  type WritingRubric,
  type WritingRubricContent,
} from "@openloop/shared";

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function loadModelStatus(): Promise<ModelStatusResponse> {
  const response = await fetch("/v1/model-status");
  return ModelStatusResponseSchema.parse(await parseResponse(response));
}

export async function loadEvaluatorStatus(): Promise<EvaluatorStatusResponse> {
  const response = await fetch("/v1/evaluator-status");
  return EvaluatorStatusResponseSchema.parse(await parseResponse(response));
}

export async function loadWritingRubrics(): Promise<WritingRubric[]> {
  const response = await fetch("/v1/writing-rubrics");
  return WritingRubricListResponseSchema.parse(await parseResponse(response))
    .rubrics;
}

export async function createWritingRubric(
  input: WritingRubricContent,
): Promise<WritingRubric> {
  const response = await fetch("/v1/writing-rubrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CreateWritingRubricRequestSchema.parse(input)),
  });
  return WritingRubricSchema.parse(await parseResponse(response));
}

export async function updateWritingRubric(
  rubricId: string,
  input: WritingRubricContent & { baseRevision: number },
): Promise<WritingRubric> {
  const response = await fetch(`/v1/writing-rubrics/${rubricId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return WritingRubricSchema.parse(await parseResponse(response));
}

export async function previewWritingEvaluation(
  documentId: string,
  intent: EvaluationIntent,
  signal?: AbortSignal,
): Promise<EvaluationPreview> {
  const response = await fetch(
    `/v1/documents/${documentId}/evaluations/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
      signal,
    },
  );
  return EvaluationPreviewSchema.parse(await parseResponse(response));
}

export async function submitWritingEvaluation(
  documentId: string,
  request: CreateEvaluationRequest,
  signal?: AbortSignal,
): Promise<WritingEvaluationRun> {
  const response = await fetch(`/v1/documents/${documentId}/evaluations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  return WritingEvaluationRunSchema.parse(await parseResponse(response));
}

export async function listWritingEvaluations(
  documentId: string,
  offset = 0,
): Promise<WritingEvaluationRunSummary[]> {
  const response = await fetch(
    `/v1/documents/${documentId}/evaluations?limit=20&offset=${offset}`,
  );
  return WritingEvaluationListResponseSchema.parse(
    await parseResponse(response),
  ).runs;
}

export async function loadWritingEvaluation(
  runId: string,
): Promise<WritingEvaluationRun> {
  const response = await fetch(`/v1/evaluations/${runId}`);
  return WritingEvaluationRunSchema.parse(await parseResponse(response));
}

export async function cancelWritingEvaluation(
  runId: string,
): Promise<WritingEvaluationRun> {
  const response = await fetch(`/v1/evaluations/${runId}/cancel`, {
    method: "POST",
  });
  return WritingEvaluationRunSchema.parse(await parseResponse(response));
}

export async function loadEvaluationFeedback(runId: string) {
  const response = await fetch(`/v1/evaluations/${runId}/feedback`);
  return WritingEvaluationFeedbackListSchema.parse(
    await parseResponse(response),
  ).feedback;
}

export async function saveEvaluationFeedback(
  runId: string,
  criterionId: string,
  input: WritingEvaluationFeedbackInput,
) {
  const response = await fetch(
    `/v1/evaluations/${runId}/feedback/${criterionId}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return WritingEvaluationFeedbackSchema.parse(await parseResponse(response));
}

export async function exportWritingEvaluation(runId: string) {
  const response = await fetch(`/v1/evaluations/${runId}/export`);
  return WritingEvaluationExportSchema.parse(await parseResponse(response));
}

export async function loadCriticAgentStatus(): Promise<CriticAgentStatusResponse> {
  const response = await fetch("/v1/critic-agent/status");
  return CriticAgentStatusResponseSchema.parse(await parseResponse(response));
}

export async function launchCriticAgent(): Promise<CriticAgentStatusResponse> {
  const response = await fetch("/v1/critic-agent/launch", { method: "POST" });
  return CriticAgentStatusResponseSchema.parse(await parseResponse(response));
}

export async function submitCriticJob(
  documentId: string,
  input: CriticJobRequest,
): Promise<string> {
  const response = await fetch(`/v1/documents/${documentId}/critic-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return CriticJobResponseSchema.parse(await parseResponse(response)).jobId;
}

export async function submitReconciliation(
  documentId: string,
  input: ReconcileRequest,
): Promise<string> {
  const response = await fetch(`/v1/documents/${documentId}/reconcile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return ReconcileJobResponseSchema.parse(await parseResponse(response)).jobId;
}

export async function requestResurfacing(
  documentId: string,
  input: ResurfaceRequest,
) {
  const response = await fetch(`/v1/documents/${documentId}/resurface`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return ResurfaceResponseSchema.parse(await parseResponse(response));
}

export async function reviewDocumentExport(
  documentId: string,
): Promise<ExportReviewResponse> {
  const response = await fetch(`/v1/documents/${documentId}/export-review`, {
    method: "POST",
  });
  return ExportReviewResponseSchema.parse(await parseResponse(response));
}

export async function downloadDocumentExport(
  documentId: string,
  force: boolean,
): Promise<Blob> {
  const query = force ? "?force=true" : "";
  const response = await fetch(`/v1/documents/${documentId}/export.md${query}`);
  if (!response.ok) {
    await parseResponse(response);
  }
  return response.blob();
}

export async function deleteLocalData(): Promise<void> {
  const response = await fetch("/v1/local-data", { method: "DELETE" });
  DeleteLocalDataResponseSchema.parse(await parseResponse(response));
}

export async function loadIssues(
  documentId: string,
  statuses?: IssueRecord["status"][],
): Promise<IssueRecord[]> {
  const query = statuses?.length
    ? `?status=${encodeURIComponent(statuses.join(","))}`
    : "";
  const response = await fetch(`/v1/documents/${documentId}/issues${query}`);
  return IssueListResponseSchema.parse(await parseResponse(response)).issues;
}

export async function loadIssueEvents(issueId: string) {
  const response = await fetch(`/v1/issues/${issueId}/events`);
  return IssueEventsResponseSchema.parse(await parseResponse(response)).events;
}

export async function performIssueAction(
  issueId: string,
  input: IssueActionRequest,
) {
  const response = await fetch(`/v1/issues/${issueId}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return IssueActionResponseSchema.parse(await parseResponse(response));
}

export async function loadIssueChat(issueId: string) {
  const response = await fetch(`/v1/issues/${issueId}/chat`);
  return IssueChatResponseSchema.parse(await parseResponse(response));
}

export async function activateIssueChat(issueId: string) {
  const response = await fetch(`/v1/issues/${issueId}/chat/activate`, {
    method: "POST",
  });
  return IssueChatResponseSchema.parse(await parseResponse(response));
}

export async function sendIssueChatMessage(
  issueId: string,
  input: IssueChatSendRequest,
) {
  const response = await fetch(`/v1/issues/${issueId}/chat/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return IssueChatSendResponseSchema.parse(await parseResponse(response));
}

async function parseResponse(response: Response): Promise<unknown> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = ApiErrorSchema.parse(payload);
    throw new ApiClientError(
      parsed.error.code,
      parsed.error.message,
      parsed.error.details,
    );
  }
  return payload;
}

export async function createDocument(
  title: string,
  contentJson: Record<string, JsonValue>,
): Promise<DocumentRecord> {
  const response = await fetch("/v1/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, contentJson }),
  });
  return DocumentRecordSchema.parse(await parseResponse(response));
}

export async function loadDocument(
  documentId: string,
): Promise<DocumentRecord> {
  const response = await fetch(`/v1/documents/${documentId}`);
  return DocumentBundleSchema.parse(await parseResponse(response)).document;
}

export async function saveDocument(input: {
  documentId: string;
  baseVersion: number;
  title: string;
  contentJson: Record<string, JsonValue>;
  plainText: string;
  changeBatch: EditorChangeBatch;
}): Promise<DocumentRecord> {
  const response = await fetch(`/v1/documents/${input.documentId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return SaveDocumentResponseSchema.parse(await parseResponse(response))
    .document;
}
