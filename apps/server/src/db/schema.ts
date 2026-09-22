import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  contentJson: text("content_json").notNull(),
  plainText: text("plain_text").notNull(),
  version: integer("version").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const documentEvents = sqliteTable(
  "document_events",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    action: text("action").notNull(),
    documentVersion: integer("document_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("document_events_document_created_idx").on(
      table.documentId,
      table.createdAt,
    ),
  ],
);

export const issues = sqliteTable(
  "issues",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    type: text("type").notNull(),
    status: text("status").notNull(),
    question: text("question").notNull(),
    rationale: text("rationale").notNull(),
    suggestedRewrite: text("suggested_rewrite"),
    severity: integer("severity").notNull(),
    confidence: real("confidence").notNull(),
    interruptWorthiness: real("interrupt_worthiness").notNull(),
    anchorJson: text("anchor_json").notNull(),
    keywordsJson: text("keywords_json").notNull(),
    resurfaceTriggersJson: text("resurface_triggers_json").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    shownCount: integer("shown_count").notNull().default(0),
    silentIgnoreCount: integer("silent_ignore_count").notNull().default(0),
    lastShownAt: integer("last_shown_at"),
    snoozedUntil: integer("snoozed_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    index("issues_document_status_idx").on(table.documentId, table.status),
    index("issues_document_dedupe_idx").on(table.documentId, table.dedupeKey),
    index("issues_document_updated_idx").on(table.documentId, table.updatedAt),
  ],
);

export const issueEvents = sqliteTable(
  "issue_events",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    action: text("action").notNull(),
    documentVersion: integer("document_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("issue_events_issue_created_idx").on(table.issueId, table.createdAt),
    index("issue_events_document_created_idx").on(
      table.documentId,
      table.createdAt,
    ),
  ],
);

export const issueChatThreads = sqliteTable(
  "issue_chat_threads",
  {
    issueId: text("issue_id")
      .primaryKey()
      .references(() => issues.id),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    state: text("state").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("issue_chat_threads_document_updated_idx").on(
      table.documentId,
      table.updatedAt,
    ),
  ],
);

export const issueChatMessages = sqliteTable(
  "issue_chat_messages",
  {
    id: text("id").primaryKey(),
    issueId: text("issue_id")
      .notNull()
      .references(() => issueChatThreads.issueId),
    role: text("role").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    attachmentsJson: text("attachments_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("issue_chat_messages_issue_created_idx").on(
      table.issueId,
      table.createdAt,
    ),
  ],
);

export const modelRuns = sqliteTable("model_runs", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  documentId: text("document_id").references(() => documents.id),
  kind: text("kind").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputHash: text("input_hash").notNull(),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  createdAt: integer("created_at").notNull(),
});

export const writingRubrics = sqliteTable("writing_rubrics", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  title: text("title").notNull(),
  contentJson: text("content_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const writingEvaluationRuns = sqliteTable(
  "writing_evaluation_runs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    requestIdentityHash: text("request_identity_hash").notNull(),
    documentVersion: integer("document_version").notNull(),
    rubricId: text("rubric_id").notNull(),
    rubricRevision: integer("rubric_revision").notNull(),
    inputHash: text("input_hash").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    compiledRequestJson: text("compiled_request_json").notNull(),
    compiledEvaluationJson: text("compiled_evaluation_json").notNull(),
    requestedModel: text("requested_model").notNull(),
    returnedModel: text("returned_model"),
    providerId: text("provider_id").notNull(),
    status: text("status").notNull(),
    resultJson: text("result_json"),
    policyVersion: text("policy_version").notNull(),
    policyJson: text("policy_json").notNull(),
    providerCalled: integer("provider_called").notNull(),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    uniqueIndex("writing_evaluation_runs_request_id_idx").on(table.requestId),
    index("writing_evaluation_runs_document_created_idx").on(
      table.documentId,
      table.createdAt,
    ),
  ],
);

export const writingEvaluationFeedback = sqliteTable(
  "writing_evaluation_feedback",
  {
    runId: text("run_id")
      .notNull()
      .references(() => writingEvaluationRuns.id, { onDelete: "cascade" }),
    criterionId: text("criterion_id").notNull(),
    verdict: text("verdict").notNull(),
    preferredLevel: integer("preferred_level"),
    comment: text("comment"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.criterionId] })],
);

export const preferenceWeights = sqliteTable(
  "preference_weights",
  {
    userId: text("user_id").notNull(),
    issueType: text("issue_type").notNull(),
    weight: real("weight").notNull(),
    explicitDismissals: integer("explicit_dismissals").notNull().default(0),
    applies: integer("applies").notNull().default(0),
    silentIgnores: integer("silent_ignores").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.issueType] })],
);
