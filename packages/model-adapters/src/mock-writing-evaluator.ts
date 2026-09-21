import {
  WritingEvaluatorResponseSchema,
  type AssessabilityAnswer,
  type ScoreAnswer,
} from "@openloop/shared";

import type { WritingEvaluator } from "./writing-evaluator.js";

const SCORE_FIXTURES = [
  {
    probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
    score: 1.6,
    confidence: 0.64,
  },
  {
    probabilities: { "0": 0.72, "1": 0.2, "2": 0.08 },
    score: 0.36,
    confidence: 0.61,
  },
  {
    probabilities: { "0": 0.45, "1": 0.1, "2": 0.45 },
    score: 1,
    confidence: 0.12,
  },
  {
    probabilities: { "0": 0.2, "1": 0.55, "2": 0.25 },
    score: 1.05,
    confidence: 0.31,
  },
  {
    probabilities: { "0": 0.45, "1": 0.1, "2": 0.45 },
    score: 1,
    confidence: 0.12,
  },
  {
    probabilities: { "0": 0.72, "1": 0.2, "2": 0.08 },
    score: 0.36,
    confidence: 0.61,
  },
] as const;

const ASSESSABILITY_FIXTURES = [
  {
    choice: "assessable",
    probabilities: {
      assessable: 0.9,
      needs_context: 0.06,
      not_applicable: 0.04,
    },
    confidence: 0.82,
  },
  {
    choice: "needs_context",
    probabilities: {
      assessable: 0.1,
      needs_context: 0.82,
      not_applicable: 0.08,
    },
    confidence: 0.72,
  },
  {
    choice: "not_applicable",
    probabilities: {
      assessable: 0.08,
      needs_context: 0.08,
      not_applicable: 0.84,
    },
    confidence: 0.75,
  },
  {
    choice: "assessable",
    probabilities: { assessable: 0.5, needs_context: 0.3, not_applicable: 0.2 },
    confidence: 0.24,
  },
  {
    choice: "assessable",
    probabilities: {
      assessable: 0.9,
      needs_context: 0.06,
      not_applicable: 0.04,
    },
    confidence: 0.82,
  },
  {
    choice: "assessable",
    probabilities: {
      assessable: 0.9,
      needs_context: 0.06,
      not_applicable: 0.04,
    },
    confidence: 0.82,
  },
] as const;

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException("Evaluation cancelled.", "AbortError");
}

export class MockWritingEvaluator implements WritingEvaluator {
  readonly providerId = "mock" as const;

  async evaluate(
    input: Parameters<WritingEvaluator["evaluate"]>[0],
    signal: AbortSignal,
  ) {
    throwIfAborted(signal);
    await Promise.resolve();
    throwIfAborted(signal);

    const answers: Record<string, ScoreAnswer | AssessabilityAnswer> = {};
    for (const mapping of input.criterionMapping) {
      const criterion =
        input.snapshot.rubricSnapshot.criteria[mapping.criterionIndex];
      if (!criterion) throw new Error("Mock fixture criterion is missing.");
      const fixtureIndex = mapping.criterionIndex % SCORE_FIXTURES.length;
      const scoreFixture = SCORE_FIXTURES[fixtureIndex];
      const assessabilityFixture = ASSESSABILITY_FIXTURES[fixtureIndex];
      if (!scoreFixture || !assessabilityFixture)
        throw new Error("Mock fixture is missing.");
      answers[mapping.scoreKey] = {
        type: "score",
        ...scoreFixture,
        legend: {
          "0": criterion.levels[0].description,
          "1": criterion.levels[1].description,
          "2": criterion.levels[2].description,
        },
      };
      answers[mapping.assessabilityKey] = {
        type: "choice",
        ...assessabilityFixture,
      };
    }
    return WritingEvaluatorResponseSchema.parse({
      model: "mock-writing-fixtures-v1",
      answers,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  }
}
