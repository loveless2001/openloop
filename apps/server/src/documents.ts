import { randomUUID } from "node:crypto";

import { tipTapJsonToPlainText } from "@openloop/core";
import {
  JsonObjectSchema,
  type DocumentRecord,
  type JsonValue,
} from "@openloop/shared";
import { and, eq } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { documents } from "./db/schema.js";

type DocumentRow = typeof documents.$inferSelect;

export class DocumentNotFoundError extends Error {
  readonly code = "DOCUMENT_NOT_FOUND";
}

export class DocumentVersionConflictError extends Error {
  readonly code = "DOCUMENT_VERSION_CONFLICT";

  constructor(readonly currentVersion: number) {
    super(`Document version is ${currentVersion}.`);
  }
}

function serializeContent(contentJson: Record<string, JsonValue>): string {
  return JSON.stringify(contentJson);
}

function toDocumentRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    contentJson: JsonObjectSchema.parse(JSON.parse(row.contentJson)),
    plainText: row.plainText,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function createDocument(
  database: Database,
  input: { title: string; contentJson: Record<string, JsonValue> },
): DocumentRecord {
  const now = Date.now();
  const row: typeof documents.$inferInsert = {
    id: randomUUID(),
    title: input.title,
    contentJson: serializeContent(input.contentJson),
    plainText: tipTapJsonToPlainText(input.contentJson),
    version: 0,
    createdAt: now,
    updatedAt: now,
  };

  database.orm.insert(documents).values(row).run();
  return toDocumentRecord(row);
}

export function getDocument(
  database: Database,
  documentId: string,
): DocumentRecord {
  const row = database.orm
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .get();
  if (!row) throw new DocumentNotFoundError("Document not found.");
  return toDocumentRecord(row);
}

export function saveDocument(
  database: Database,
  documentId: string,
  input: {
    baseVersion: number;
    title: string;
    contentJson: Record<string, JsonValue>;
  },
): DocumentRecord {
  const nextVersion = input.baseVersion + 1;
  const updated = database.orm
    .update(documents)
    .set({
      title: input.title,
      contentJson: serializeContent(input.contentJson),
      plainText: tipTapJsonToPlainText(input.contentJson),
      version: nextVersion,
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.version, input.baseVersion),
      ),
    )
    .returning()
    .get();

  if (updated) return toDocumentRecord(updated);

  const current = database.orm
    .select({ version: documents.version })
    .from(documents)
    .where(eq(documents.id, documentId))
    .get();
  if (!current) throw new DocumentNotFoundError("Document not found.");
  throw new DocumentVersionConflictError(current.version);
}
