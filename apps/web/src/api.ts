import {
  ApiErrorSchema,
  CriticJobResponseSchema,
  DocumentBundleSchema,
  DocumentRecordSchema,
  IssueActionResponseSchema,
  IssueEventsResponseSchema,
  IssueListResponseSchema,
  ModelStatusResponseSchema,
  SaveDocumentResponseSchema,
  type CriticJobRequest,
  type DocumentRecord,
  type IssueActionRequest,
  type IssueRecord,
  type EditorChangeBatch,
  type JsonValue,
  type ModelStatusResponse,
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
