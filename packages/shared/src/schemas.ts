import { z } from "zod";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const TextBlockSnapshotSchema = z.object({
  nodeId: z.uuid(),
  nodeType: z.enum(["paragraph", "heading", "blockquote"]),
  text: z.string(),
  previousText: z.string().optional(),
  previousNodeText: z.string().optional(),
  nextNodeText: z.string().optional(),
  headingPath: z.array(z.string()),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
});

export type TextBlockSnapshot = z.infer<typeof TextBlockSnapshotSchema>;

export const EditorChangeBatchSchema = z.object({
  documentId: z.uuid(),
  baseVersion: z.number().int().nonnegative(),
  clientSequence: z.number().int().positive(),
  changedBlocks: z.array(TextBlockSnapshotSchema),
  removedNodeIds: z.array(z.uuid()),
  mergedNodeMap: z.record(z.uuid(), z.uuid()),
  reason: z.enum(["typing", "split", "merge", "paste", "format", "load"]),
});

export type EditorChangeBatch = z.infer<typeof EditorChangeBatchSchema>;

export const DocumentRecordSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  contentJson: JsonObjectSchema,
  plainText: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type DocumentRecord = z.infer<typeof DocumentRecordSchema>;

export const CreateDocumentRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  contentJson: JsonObjectSchema,
});

export const SaveDocumentRequestSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(200),
  contentJson: JsonObjectSchema,
  plainText: z.string(),
  changeBatch: EditorChangeBatchSchema,
});

export const DocumentBundleSchema = z.object({
  document: DocumentRecordSchema,
  issues: z.array(z.never()),
  preferences: z.array(z.never()),
});

export const SaveDocumentResponseSchema = z.object({
  document: DocumentRecordSchema,
  impactedIssueIds: z.array(z.uuid()),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
});
