import { z } from "zod";

import { JsonObjectSchema, TextBlockSnapshotSchema } from "./schemas.js";

export const WRITING_EVALUATION_MAX_BYTES = 24_000;
export const WRITING_EVALUATION_ASSESSABILITY_THRESHOLD = 0.7;
export const WRITING_EVALUATION_LEVEL_THRESHOLD = 0.6;

export const WritingScopeSchema = z.enum(["selection", "document"]);
export const WritingLanguageHintSchema = z.enum([
  "en",
  "vi",
  "other",
  "unspecified",
]);

export const RubricLevelSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(800),
});

export const WritingCriterionSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    question: z.string().trim().min(1).max(800),
    allowedScopes: z.array(WritingScopeSchema).min(1).max(2),
    levels: z.tuple([RubricLevelSchema, RubricLevelSchema, RubricLevelSchema]),
  })
  .superRefine((criterion, context) => {
    if (
      new Set(criterion.allowedScopes).size !== criterion.allowedScopes.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Allowed scopes must be unique.",
        path: ["allowedScopes"],
      });
    }
    const descriptions = criterion.levels.map((level) => level.description);
    if (new Set(descriptions).size !== descriptions.length) {
      context.addIssue({
        code: "custom",
        message: "Every rubric level needs a distinct description.",
        path: ["levels"],
      });
    }
  });

export const WritingRubricContentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    purpose: z.string().trim().max(1_000),
    audience: z.string().trim().max(1_000),
    criteria: z.array(WritingCriterionSchema).min(1).max(6),
  })
  .superRefine((rubric, context) => {
    const criterionIds = rubric.criteria.map((criterion) => criterion.id);
    if (new Set(criterionIds).size !== criterionIds.length) {
      context.addIssue({
        code: "custom",
        message: "Criterion IDs must be unique within a rubric.",
        path: ["criteria"],
      });
    }
  });

export const WritingRubricSchema = WritingRubricContentSchema.extend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateWritingRubricRequestSchema = WritingRubricContentSchema;
export const UpdateWritingRubricRequestSchema =
  WritingRubricContentSchema.extend({
    baseRevision: z.number().int().positive(),
  });
export const WritingRubricListResponseSchema = z.object({
  rubrics: z.array(WritingRubricSchema),
});

const SelectionEvaluationScopeSchema = z.object({
  kind: z.literal("selection"),
  fragments: z
    .array(
      TextBlockSnapshotSchema.required({
        selectionStart: true,
        selectionEnd: true,
      }),
    )
    .min(1)
    .max(250),
  contextMode: z.enum(["none", "nearby"]),
});

export const EvaluationIntentSchema = z.object({
  documentVersion: z.number().int().nonnegative(),
  rubricId: z.uuid(),
  rubricRevision: z.number().int().positive(),
  scope: z.discriminatedUnion("kind", [
    SelectionEvaluationScopeSchema,
    z.object({ kind: z.literal("document") }),
  ]),
  languageHint: WritingLanguageHintSchema,
});

export const CreateEvaluationRequestSchema = EvaluationIntentSchema.extend({
  requestId: z.uuid(),
  expectedInputHash: z.string().regex(/^[0-9a-f]{64}$/),
  remoteSubmissionConfirmed: z.boolean(),
});

export const EvaluationContextSchema = z.object({
  mode: z.enum(["none", "nearby"]),
  before: z.string(),
  after: z.string(),
  beforeClipped: z.boolean(),
  afterClipped: z.boolean(),
});

export const EvaluationSnapshotSchema = z.object({
  schemaVersion: z.literal("writing-evaluation.v1"),
  documentId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  documentContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  scope: WritingScopeSchema,
  selectionFragments: z.array(TextBlockSnapshotSchema).optional(),
  targetText: z.string().min(1),
  context: EvaluationContextSchema,
  languageHint: WritingLanguageHintSchema,
  rubricSnapshot: WritingRubricSchema,
  rubricContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  serializerVersion: z.literal("evaluation-text.v1"),
  compilerVersion: z.literal("jev-writing.v1"),
  policyVersion: z.literal("jev-display.v1"),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
});

const ScoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  criteria: z.tuple([z.string(), z.string(), z.string()]),
});
const ChoiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z.object({
    assessable: z.string(),
    needs_context: z.string(),
    not_applicable: z.string(),
  }),
});

export const CompiledProviderRequestSchema = z.object({
  state: JsonObjectSchema,
  model: z.string().min(1),
  questions: z.record(
    z.string(),
    z.union([ScoreQuestionSchema, ChoiceQuestionSchema]),
  ),
});

export const CompiledCriterionMappingSchema = z.object({
  criterionId: z.uuid(),
  criterionIndex: z.number().int().nonnegative(),
  scoreKey: z.string().min(1),
  assessabilityKey: z.string().min(1),
});

export const CompiledWritingEvaluationSchema = z.object({
  snapshot: EvaluationSnapshotSchema,
  request: CompiledProviderRequestSchema,
  criterionMapping: z.array(CompiledCriterionMappingSchema),
  incompatibleCriterionIds: z.array(z.uuid()),
});

export const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number().finite().min(0).max(2),
  probabilities: z
    .object({
      "0": z.number().finite().min(0).max(1),
      "1": z.number().finite().min(0).max(1),
      "2": z.number().finite().min(0).max(1),
    })
    .strict(),
  legend: z
    .object({ "0": z.string(), "1": z.string(), "2": z.string() })
    .strict(),
  confidence: z.number().finite().min(0).max(1),
});

export const AssessabilityAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.enum(["assessable", "needs_context", "not_applicable"]),
  probabilities: z
    .object({
      assessable: z.number().finite().min(0).max(1),
      needs_context: z.number().finite().min(0).max(1),
      not_applicable: z.number().finite().min(0).max(1),
    })
    .strict(),
  confidence: z.number().finite().min(0).max(1),
});

export const WritingEvaluatorResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(
    z.string(),
    z.union([ScoreAnswerSchema, AssessabilityAnswerSchema]),
  ),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

export const CriterionAssessmentStatusSchema = z.enum([
  "assessed",
  "needs_context",
  "not_applicable",
  "uncertain_assessability",
  "incompatible_scope",
]);

export const CriterionAssessmentSchema = z.object({
  criterionId: z.uuid(),
  status: CriterionAssessmentStatusSchema,
  primaryLevel: z.number().int().min(0).max(2).optional(),
  mixed: z.boolean(),
  score: ScoreAnswerSchema.optional(),
  assessability: AssessabilityAnswerSchema.optional(),
});

export const WritingEvaluationResultSchema = z.object({
  criteria: z.array(CriterionAssessmentSchema),
  assessabilityThreshold: z.number().min(0).max(1),
  levelThreshold: z.number().min(0).max(1),
  providerCalled: z.boolean(),
});

export const EvaluationRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const WritingEvaluationRunSummarySchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  requestId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  rubricId: z.uuid(),
  rubricRevision: z.number().int().positive(),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  providerId: z.enum(["mock", "typesafe"]),
  requestedModel: z.string().min(1),
  returnedModel: z.string().min(1).optional(),
  status: EvaluationRunStatusSchema,
  providerCalled: z.boolean(),
  failure: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
});

export const WritingEvaluationRunSchema =
  WritingEvaluationRunSummarySchema.extend({
    snapshot: EvaluationSnapshotSchema,
    compiledRequest: CompiledProviderRequestSchema,
    result: WritingEvaluationResultSchema.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      })
      .optional(),
  });

export const WritingEvaluationFeedbackInputSchema = z
  .object({
    verdict: z.enum([
      "agree",
      "disagree",
      "unclear_rubric",
      "missing_context",
      "not_applicable",
      "unsure",
    ]),
    preferredLevel: z.number().int().min(0).max(2).optional(),
    comment: z.string().max(2_000).optional(),
  })
  .strict();

export const WritingEvaluationFeedbackSchema =
  WritingEvaluationFeedbackInputSchema.extend({
    runId: z.uuid(),
    criterionId: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  });

export const WritingEvaluationFeedbackListSchema = z.object({
  feedback: z.array(WritingEvaluationFeedbackSchema),
});

export const WritingEvaluationExportSchema = z.object({
  schemaVersion: z.literal("writing-evaluation-export.v1"),
  exportedAt: z.iso.datetime(),
  sourceTextWarning: z.literal(
    "Contains the evaluated source text, context, rubric, and author comments.",
  ),
  signalProvenance: z.object({
    assessment: z.enum(["mock_fixture", "model_assessment"]),
    feedback: z.literal("author_feedback_not_verified_ground_truth"),
  }),
  run: WritingEvaluationRunSchema,
  policy: z.object({
    version: z.literal("jev-display.v1"),
    assessabilityThreshold: z.number().min(0).max(1),
    levelThreshold: z.number().min(0).max(1),
  }),
  feedback: z.array(WritingEvaluationFeedbackSchema),
});

export type WritingEvaluationFeedbackInput = z.infer<
  typeof WritingEvaluationFeedbackInputSchema
>;
export type WritingEvaluationFeedback = z.infer<
  typeof WritingEvaluationFeedbackSchema
>;
export type WritingEvaluationExport = z.infer<
  typeof WritingEvaluationExportSchema
>;

export const EvaluationPreviewSchema = z.object({
  snapshot: EvaluationSnapshotSchema,
  compiledRequest: CompiledProviderRequestSchema,
  byteCount: z.number().int().nonnegative(),
  byteLimit: z.literal(WRITING_EVALUATION_MAX_BYTES),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  providerId: z.enum(["mock", "typesafe"]),
  requestedModel: z.string().min(1),
  endpointIdentity: z.string().min(1),
});

export const EvaluatorStatusResponseSchema = z.object({
  providerId: z.enum(["mock", "typesafe"]),
  requestedModel: z.string().min(1),
  mode: z.enum(["mock", "remote", "disabled"]),
  configured: z.boolean(),
  label: z.string().min(1),
  destination: z.string().min(1),
  byteLimit: z.literal(WRITING_EVALUATION_MAX_BYTES),
});

export const WritingEvaluationListResponseSchema = z.object({
  runs: z.array(WritingEvaluationRunSummarySchema),
});

export type WritingScope = z.infer<typeof WritingScopeSchema>;
export type WritingLanguageHint = z.infer<typeof WritingLanguageHintSchema>;
export type WritingCriterion = z.infer<typeof WritingCriterionSchema>;
export type WritingRubricContent = z.infer<typeof WritingRubricContentSchema>;
export type WritingRubric = z.infer<typeof WritingRubricSchema>;
export type EvaluationIntent = z.infer<typeof EvaluationIntentSchema>;
export type CreateEvaluationRequest = z.infer<
  typeof CreateEvaluationRequestSchema
>;
export type EvaluationSnapshot = z.infer<typeof EvaluationSnapshotSchema>;
export type CompiledProviderRequest = z.infer<
  typeof CompiledProviderRequestSchema
>;
export type CompiledWritingEvaluation = z.infer<
  typeof CompiledWritingEvaluationSchema
>;
export type WritingEvaluatorResponse = z.infer<
  typeof WritingEvaluatorResponseSchema
>;
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;
export type AssessabilityAnswer = z.infer<typeof AssessabilityAnswerSchema>;
export type CriterionAssessment = z.infer<typeof CriterionAssessmentSchema>;
export type WritingEvaluationResult = z.infer<
  typeof WritingEvaluationResultSchema
>;
export type EvaluationRunStatus = z.infer<typeof EvaluationRunStatusSchema>;
export type WritingEvaluationRun = z.infer<typeof WritingEvaluationRunSchema>;
export type WritingEvaluationRunSummary = z.infer<
  typeof WritingEvaluationRunSummarySchema
>;
export type EvaluationPreview = z.infer<typeof EvaluationPreviewSchema>;
export type EvaluatorStatusResponse = z.infer<
  typeof EvaluatorStatusResponseSchema
>;
