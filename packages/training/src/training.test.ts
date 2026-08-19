import { describe, expect, it } from "vitest";

import { compileDatasets } from "./compiler.js";
import { evaluateDeploymentGates } from "./gates.js";
import { buildPlannedStageManifest } from "./manifest.js";
import type {
  AutocompleteMetrics,
  PipelineConfig,
  TrainingTraceV2,
} from "./schemas.js";

const requestId = "f9a0423b-6f8d-4195-b116-a32673efdaf5";
const documentId = "aac4635f-dd5f-4ce0-a42e-82e2cff2a85a";
const nodeId = "ed033693-ee92-4729-a56f-f8f51fdd896e";

const config: PipelineConfig = {
  schemaVersion: 1,
  experimentName: "test",
  seed: "fixed-seed",
  baseModel: {
    huggingFaceId: "Qwen/Qwen2.5-0.5B",
    revision: "pinned",
    deployedOllamaModel: "qwen2.5:0.5b",
  },
  data: {
    tracePaths: [],
    corpusPaths: [],
    outputDirectory: "data/training/test",
    split: { train: 0.8, validation: 0.1, test: 0.1 },
    cptChunkCharacters: 256,
    continuationPrefixCharacters: 64,
    continuationTargetCharacters: 32,
    fimRate: 0.5,
  },
  stages: {
    cpt: {
      enabled: true,
      adapter: "lora",
      learningRate: 0.00005,
      epochs: 1,
      maxSequenceTokens: 1024,
      microBatchSize: 1,
      gradientAccumulationSteps: 16,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
      genericReplayRatio: 0.1,
    },
    sft: {
      enabled: true,
      adapter: "lora",
      learningRate: 0.00002,
      epochs: 2,
      maxSequenceTokens: 2048,
      microBatchSize: 1,
      gradientAccumulationSteps: 16,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
      genericReplayRatio: 0.1,
    },
    preference: {
      enabled: false,
      adapter: "lora",
      method: "dpo",
      beta: 0.1,
      minimumExamples: 100,
      learningRate: 0.000005,
      epochs: 1,
      maxSequenceTokens: 2048,
      microBatchSize: 1,
      gradientAccumulationSteps: 16,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
      genericReplayRatio: 0.1,
    },
  },
  deployment: {
    ollamaModelName: "openloop-test:v1",
    quantizationCandidates: ["Q4_K_M"],
  },
  gates: {
    maximumP95TtftRegression: 0.1,
    requireUtilityImprovement: true,
    rejectMemorizationFlag: true,
  },
};

function traceRecords(): TrainingTraceV2[] {
  return [
    {
      schemaVersion: 2,
      recordedAt: "2026-08-19T12:00:00.000Z",
      type: "completion_candidate",
      requestId,
      candidateId: requestId,
      source: "model",
      provider: "ollama",
      model: "qwen2.5:0.5b",
      modelArtifact: "qwen2.5:0.5b",
      promptVersion: "completion.v1",
      documentId,
      documentVersion: 3,
      nodeId,
      documentTitle: "Draft",
      prefix: "The model",
      suffix: "",
      headingPath: ["Architecture"],
      suggestion: " stays local and fast.",
      status: "completed",
      decoding: {
        maxOutputTokens: 60,
        temperature: 0.2,
        contextTokens: 2048,
      },
    },
    {
      schemaVersion: 2,
      recordedAt: "2026-08-19T12:00:01.000Z",
      type: "completion_feedback",
      requestId,
      candidateId: requestId,
      documentId,
      documentVersion: 3,
      nodeId,
      event: "completion_accepted_word",
      acceptedCharacters: 7,
    },
    {
      schemaVersion: 2,
      recordedAt: "2026-08-19T12:00:02.000Z",
      type: "completion_feedback",
      requestId,
      candidateId: requestId,
      documentId,
      documentVersion: 3,
      nodeId,
      event: "completion_rejected",
    },
    {
      schemaVersion: 2,
      recordedAt: "2026-08-19T12:00:03.000Z",
      type: "completion_replacement",
      requestId,
      candidateId: requestId,
      documentId,
      documentVersion: 3,
      nodeId,
      replacementText: " remains private.",
      stopReason: "paragraph_boundary",
    },
  ];
}

describe("offline dataset compiler", () => {
  it("builds positive continuations and true rejection pairs deterministically", () => {
    const first = compileDatasets({
      config,
      records: traceRecords(),
      documents: [],
    });
    const second = compileDatasets({
      config,
      records: traceRecords(),
      documents: [],
    });

    expect(first).toEqual(second);
    expect(first.continuations).toHaveLength(1);
    expect(first.continuations[0]).toMatchObject({
      target: " stays ",
      provenance: "accepted_suggestion",
    });
    expect(first.preferences[0]).toMatchObject({
      prefix: "The model stays ",
      chosen: " remains private.",
      rejected: "local and fast.",
      labelType: "explicit_rejection_with_replacement",
    });
  });

  it("assigns all windows from one document to one leakage-safe split", () => {
    const compiled = compileDatasets({
      config,
      records: [],
      documents: [
        {
          sourceId: "writer/draft.md",
          text: "A long private passage. ".repeat(80),
        },
      ],
    });
    const splits = new Set([
      ...compiled.cpt.map((example) => example.split),
      ...compiled.continuations.map((example) => example.split),
    ]);
    expect(splits.size).toBe(1);
    expect(compiled.cpt.some((example) => example.objective === "fim")).toBe(
      true,
    );
  });
});

describe("deployment gates and plans", () => {
  const baseline: AutocompleteMetrics = {
    schemaVersion: 1,
    modelArtifact: "base",
    datasetManifestHash: "a".repeat(64),
    heldOutUtility: 0.4,
    normalizedCharacterPrefixMatch: 0.3,
    acceptedCharacterSimulation: 0.2,
    malformedRate: 0.02,
    repeatedPrefixRate: 0.03,
    unwantedNewlineRate: 0.04,
    p50TimeToFirstTokenMs: 80,
    p95TimeToFirstTokenMs: 100,
    p50TotalGenerationMs: 140,
    p95TotalGenerationMs: 220,
    residentMemoryMiB: 640,
    warmResidencyVerified: true,
    memorizationFlag: false,
  };

  it("requires quality, latency, output-shape, and memorization gates", () => {
    expect(
      evaluateDeploymentGates({
        baseline,
        candidate: {
          ...baseline,
          modelArtifact: "candidate",
          heldOutUtility: 0.5,
          p95TimeToFirstTokenMs: 109,
        },
        gates: config.gates,
      }).verdict,
    ).toBe("pass");

    expect(
      evaluateDeploymentGates({
        baseline,
        candidate: {
          ...baseline,
          modelArtifact: "candidate",
          heldOutUtility: 0.5,
          memorizationFlag: true,
        },
        gates: config.gates,
      }).verdict,
    ).toBe("fail");

    expect(
      evaluateDeploymentGates({
        baseline,
        candidate: {
          ...baseline,
          modelArtifact: "candidate",
          datasetManifestHash: "c".repeat(64),
          heldOutUtility: 0.5,
        },
        gates: config.gates,
      }).verdict,
    ).toBe("fail");
  });

  it("creates reviewable stage plans with execution disabled", () => {
    expect(
      buildPlannedStageManifest({
        config,
        datasetManifestHash: "b".repeat(64),
        stage: "cpt",
      }),
    ).toMatchObject({
      stage: "cpt",
      status: "planned",
      executionEnabled: false,
      stageConfig: config.stages.cpt,
    });
  });
});
