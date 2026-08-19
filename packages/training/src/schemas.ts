import { z } from "zod";

export const TrainingCompletionInteractionEventSchema = z.enum([
  "completion_requested",
  "completion_shown",
  "completion_accepted_full",
  "completion_accepted_word",
  "completion_rejected",
  "completion_dismissed",
  "completion_stale",
  "completion_error",
]);

const TraceBaseSchema = z.object({
  schemaVersion: z.literal(2),
  recordedAt: z.iso.datetime(),
  requestId: z.uuid(),
  candidateId: z.uuid(),
});

export const CompletionCandidateTraceV2Schema = TraceBaseSchema.extend({
  type: z.literal("completion_candidate"),
  source: z.enum(["model", "dictionary"]),
  provider: z.string().min(1),
  model: z.string().min(1),
  modelArtifact: z.string().min(1),
  promptVersion: z.string().min(1),
  documentId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  nodeId: z.uuid(),
  documentTitle: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  headingPath: z.array(z.string()),
  suggestion: z.string(),
  status: z.enum(["completed", "aborted", "error"]),
  errorCode: z.string().optional(),
  decoding: z.object({
    maxOutputTokens: z.number().int().positive(),
    temperature: z.number().min(0),
    contextTokens: z.number().int().positive().optional(),
  }),
});

export const CompletionFeedbackTraceV2Schema = TraceBaseSchema.extend({
  type: z.literal("completion_feedback"),
  documentId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  nodeId: z.uuid(),
  event: TrainingCompletionInteractionEventSchema,
  acceptedCharacters: z.number().int().nonnegative().optional(),
});

export const CompletionReplacementTraceV2Schema = TraceBaseSchema.extend({
  type: z.literal("completion_replacement"),
  documentId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  nodeId: z.uuid(),
  replacementText: z.string().min(1).max(128),
  stopReason: z.enum([
    "character_limit",
    "paragraph_boundary",
    "document_switch",
    "timeout",
  ]),
});

export const NaturalContinuationTraceV2Schema = z.object({
  schemaVersion: z.literal(2),
  recordedAt: z.iso.datetime(),
  type: z.literal("natural_continuation"),
  sampleId: z.uuid(),
  documentId: z.uuid(),
  documentVersion: z.number().int().nonnegative(),
  nodeId: z.uuid(),
  documentTitle: z.string(),
  headingPath: z.array(z.string()),
  prefix: z.string(),
  suffix: z.string(),
  continuation: z.string().min(1).max(512),
});

export const TrainingTraceV2Schema = z.discriminatedUnion("type", [
  CompletionCandidateTraceV2Schema,
  CompletionFeedbackTraceV2Schema,
  CompletionReplacementTraceV2Schema,
  NaturalContinuationTraceV2Schema,
]);

export type CompletionCandidateTraceV2 = z.infer<
  typeof CompletionCandidateTraceV2Schema
>;
export type CompletionFeedbackTraceV2 = z.infer<
  typeof CompletionFeedbackTraceV2Schema
>;
export type CompletionReplacementTraceV2 = z.infer<
  typeof CompletionReplacementTraceV2Schema
>;
export type NaturalContinuationTraceV2 = z.infer<
  typeof NaturalContinuationTraceV2Schema
>;
export type TrainingTraceV2 = z.infer<typeof TrainingTraceV2Schema>;

export const DatasetSplitSchema = z.enum(["train", "validation", "test"]);
export type DatasetSplit = z.infer<typeof DatasetSplitSchema>;

export const CptExampleSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  split: DatasetSplitSchema,
  sourceId: z.string(),
  objective: z.enum(["causal", "fim"]),
  text: z.string().min(1),
  prefix: z.string().optional(),
  middle: z.string().optional(),
  suffix: z.string().optional(),
});

export const ContinuationExampleSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  split: DatasetSplitSchema,
  sourceId: z.string(),
  provenance: z.enum(["accepted_suggestion", "natural_continuation"]),
  documentTitle: z.string(),
  headingPath: z.array(z.string()),
  prefix: z.string(),
  suffix: z.string(),
  target: z.string().min(1),
});

export const PreferenceExampleSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  split: DatasetSplitSchema,
  sourceId: z.string(),
  labelType: z.literal("explicit_rejection_with_replacement"),
  documentTitle: z.string(),
  headingPath: z.array(z.string()),
  prefix: z.string(),
  suffix: z.string(),
  chosen: z.string().min(1),
  rejected: z.string().min(1),
});

export type CptExample = z.infer<typeof CptExampleSchema>;
export type ContinuationExample = z.infer<typeof ContinuationExampleSchema>;
export type PreferenceExample = z.infer<typeof PreferenceExampleSchema>;

const AdapterTrainingConfigSchema = z.object({
  enabled: z.boolean(),
  adapter: z.literal("lora"),
  learningRate: z.number().positive(),
  epochs: z.number().positive(),
  maxSequenceTokens: z.number().int().positive(),
  microBatchSize: z.number().int().positive(),
  gradientAccumulationSteps: z.number().int().positive(),
  loraRank: z.number().int().positive(),
  loraAlpha: z.number().positive(),
  loraDropout: z.number().min(0).max(1),
  genericReplayRatio: z.number().min(0).max(1),
});

export const PipelineConfigSchema = z.object({
  schemaVersion: z.literal(1),
  experimentName: z.string().min(1),
  seed: z.string().min(1),
  baseModel: z.object({
    huggingFaceId: z.string().min(1),
    revision: z.string().min(1),
    deployedOllamaModel: z.string().min(1),
  }),
  data: z.object({
    tracePaths: z.array(z.string()).default([]),
    corpusPaths: z.array(z.string()).default([]),
    outputDirectory: z.string().min(1),
    split: z.object({
      train: z.number().positive(),
      validation: z.number().positive(),
      test: z.number().positive(),
    }),
    cptChunkCharacters: z.number().int().min(256).max(16_384),
    continuationPrefixCharacters: z.number().int().min(64).max(4_096),
    continuationTargetCharacters: z.number().int().min(16).max(512),
    fimRate: z.number().min(0).max(1),
  }),
  stages: z.object({
    cpt: AdapterTrainingConfigSchema,
    sft: AdapterTrainingConfigSchema,
    preference: AdapterTrainingConfigSchema.extend({
      method: z.enum(["dpo", "kto"]),
      beta: z.number().positive(),
      minimumExamples: z.number().int().positive(),
    }),
  }),
  deployment: z.object({
    ollamaModelName: z.string().min(1),
    quantizationCandidates: z.array(z.string().min(1)).min(1),
  }),
  gates: z.object({
    maximumP95TtftRegression: z.number().min(0).max(1),
    requireUtilityImprovement: z.boolean(),
    rejectMemorizationFlag: z.boolean(),
  }),
});

export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

export const AutocompleteMetricsSchema = z.object({
  schemaVersion: z.literal(1),
  modelArtifact: z.string().min(1),
  datasetManifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  heldOutUtility: z.number(),
  continuationNegativeLogLikelihood: z.number().nonnegative().optional(),
  normalizedCharacterPrefixMatch: z.number().min(0).max(1),
  acceptedCharacterSimulation: z.number().min(0).max(1),
  malformedRate: z.number().min(0).max(1),
  repeatedPrefixRate: z.number().min(0).max(1),
  unwantedNewlineRate: z.number().min(0).max(1),
  p50TimeToFirstTokenMs: z.number().nonnegative(),
  p95TimeToFirstTokenMs: z.number().nonnegative(),
  p50TotalGenerationMs: z.number().nonnegative(),
  p95TotalGenerationMs: z.number().nonnegative(),
  residentMemoryMiB: z.number().nonnegative(),
  warmResidencyVerified: z.boolean(),
  memorizationFlag: z.boolean(),
});

export type AutocompleteMetrics = z.infer<typeof AutocompleteMetricsSchema>;
