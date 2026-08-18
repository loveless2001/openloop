import {
  ApiErrorSchema,
  DocumentBundleSchema,
  DocumentRecordSchema,
  SaveDocumentResponseSchema,
  type DocumentRecord,
  type EditorChangeBatch,
  type JsonValue,
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
