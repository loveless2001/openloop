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

export const IssueType = z.enum([
  "unsupported_claim",
  "ambiguity",
  "contradiction",
  "missing_definition",
  "scope_jump",
  "evidence_gap",
  "causal_gap",
  "structure",
  "tone_mismatch",
  "other",
]);

export const IssueStatus = z.enum([
  "open",
  "snoozed",
  "needs_review",
  "resolved",
  "dismissed",
  "invalidated",
]);

export const IssueAction = z.enum([
  "show",
  "apply_rewrite",
  "snooze",
  "dismiss",
  "resolve",
  "silent_ignore",
  "reopen",
  "anchor_remapped",
  "reconciled_persists",
  "reconciled_resolved",
  "reconciled_invalidated",
  "reconciled_uncertain",
]);

export const ResurfaceTrigger = z.enum([
  "claim_reused",
  "section_end",
  "before_export",
  "severity_escalated",
  "manual_review",
]);

export const IssueCandidateSchema = z.object({
  type: IssueType,
  anchorQuote: z.string().min(3).max(400),
  question: z.string().min(5).max(500),
  rationale: z.string().min(5).max(600),
  suggestedRewrite: z.string().max(1200).optional(),
  severity: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  interruptWorthiness: z.number().min(0).max(1),
  resurfaceTriggers: z.array(ResurfaceTrigger).max(4),
  keywords: z.array(z.string().min(2).max(80)).max(8).default([]),
});

export const IssueAnchorSchema = z.object({
  nodeId: z.uuid(),
  quote: z.string(),
  quoteStart: z.number().int().nonnegative().optional(),
  quoteEnd: z.number().int().nonnegative().optional(),
  leftContext: z.string(),
  rightContext: z.string(),
  normalizedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  sourceDocumentVersion: z.number().int().nonnegative(),
  detached: z.boolean(),
});

const IssueSeveritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const IssueRecordSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  type: IssueType,
  status: IssueStatus,
  question: z.string(),
  rationale: z.string(),
  suggestedRewrite: z.string().optional(),
  severity: IssueSeveritySchema,
  confidence: z.number().min(0).max(1),
  interruptWorthiness: z.number().min(0).max(1),
  anchor: IssueAnchorSchema,
  keywords: z.array(z.string()),
  resurfaceTriggers: z.array(ResurfaceTrigger),
  dedupeKey: z.string().regex(/^[0-9a-f]{64}$/),
  shownCount: z.number().int().nonnegative(),
  silentIgnoreCount: z.number().int().nonnegative(),
  lastShownAt: z.iso.datetime().optional(),
  snoozedUntil: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
});

export type IssueRecord = z.infer<typeof IssueRecordSchema>;

export const IssueEventRecordSchema = z.object({
  id: z.uuid(),
  issueId: z.uuid(),
  documentId: z.uuid(),
  action: IssueAction,
  documentVersion: z.number().int().nonnegative(),
  payload: JsonObjectSchema,
  createdAt: z.iso.datetime(),
});

export type IssueEventRecord = z.infer<typeof IssueEventRecordSchema>;

export const DocumentBundleSchema = z.object({
  document: DocumentRecordSchema,
  issues: z.array(IssueRecordSchema),
  preferences: z.array(z.never()),
});

export const CriticTriggerSchema = z.enum([
  "idle",
  "paragraph_end",
  "heading_created",
  "manual",
]);

export type CriticTrigger = z.infer<typeof CriticTriggerSchema>;

export const CriticJobRequestSchema = z.object({
  requestId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  trigger: CriticTriggerSchema,
  changedBlocks: z.array(TextBlockSnapshotSchema).max(100),
});

export type CriticJobRequest = z.infer<typeof CriticJobRequestSchema>;

export const CriticJobResponseSchema = z.object({
  jobId: z.uuid(),
  status: z.literal("queued"),
});

export const IssueListResponseSchema = z.object({
  issues: z.array(IssueRecordSchema),
});

export const IssueEventsResponseSchema = z.object({
  events: z.array(IssueEventRecordSchema),
});

export const IssueActionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("snooze"),
    documentVersion: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("dismiss"),
    documentVersion: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("resolve"),
    documentVersion: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("reopen"),
    documentVersion: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("apply_rewrite"),
    documentVersion: z.number().int().nonnegative(),
    expectedAnchorQuote: z.string().min(3).max(400),
  }),
]);

export type IssueActionRequest = z.infer<typeof IssueActionRequestSchema>;

export const EditorOperationSchema = z.object({
  nodeId: z.uuid(),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  insertText: z.string(),
});

export type EditorOperation = z.infer<typeof EditorOperationSchema>;

export const IssueActionResponseSchema = z.object({
  issue: IssueRecordSchema,
  editorOperation: EditorOperationSchema.optional(),
});

export const ReconcileResultSchema = z.object({
  outcome: z.enum(["persists", "resolved", "invalidated", "uncertain"]),
  reason: z.string().min(3).max(500),
  newAnchorQuote: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1),
});

export const CompletionStreamRequestSchema = z.object({
  requestId: z.uuid(),
  documentId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  nodeId: z.uuid(),
  cursorOffset: z.number().int().nonnegative(),
  prefix: z.string().max(1500),
  suffix: z.string().max(300).default(""),
  headingPath: z.array(z.string().max(200)).max(12),
  prefixHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type CompletionStreamRequest = z.infer<
  typeof CompletionStreamRequestSchema
>;

export const CompletionInteractionEvent = z.enum([
  "completion_requested",
  "completion_shown",
  "completion_accepted_full",
  "completion_accepted_word",
  "completion_dismissed",
  "completion_stale",
  "completion_error",
]);

export const CompletionInteractionRequestSchema = z.object({
  requestId: z.uuid(),
  documentId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  nodeId: z.uuid(),
  event: CompletionInteractionEvent,
  acceptedCharacters: z.number().int().nonnegative().optional(),
});

export type CompletionInteractionRequest = z.infer<
  typeof CompletionInteractionRequestSchema
>;
