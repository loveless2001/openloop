import {
  deriveWritingEvaluationResult,
  prepareWritingEvaluation,
} from "@openloop/core";
import type { DocumentRecord, WritingRubric } from "@openloop/shared";
import { describe, expect, it } from "vitest";

import { MockWritingEvaluator } from "./mock-writing-evaluator.js";

describe("MockWritingEvaluator", () => {
  it("returns stable fixture-driven answers without inspecting prose quality", async () => {
    const criterionIds = [
      "11111111-1111-4111-8111-111111111111",
      "11111111-1111-4111-8111-111111111112",
      "11111111-1111-4111-8111-111111111113",
      "11111111-1111-4111-8111-111111111114",
      "11111111-1111-4111-8111-111111111115",
      "11111111-1111-4111-8111-111111111116",
    ];
    const document: DocumentRecord = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Draft",
      contentJson: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: "33333333-3333-4333-8333-333333333333" },
            content: [{ type: "text", text: "Any text." }],
          },
        ],
      },
      plainText: "Any text.",
      version: 0,
      createdAt: "2026-09-21T00:00:00.000Z",
      updatedAt: "2026-09-21T00:00:00.000Z",
    };
    const rubric: WritingRubric = {
      id: "44444444-4444-4444-8444-444444444444",
      revision: 1,
      title: "Goals",
      purpose: "",
      audience: "",
      criteria: criterionIds.map((id, index) => ({
        id,
        name: `Criterion ${index + 1}`,
        question: "Is it aligned?",
        allowedScopes: ["document"] as const,
        levels: [
          { label: "Low", description: "Low fixture." },
          { label: "Some", description: "Middle fixture." },
          { label: "Strong", description: "High fixture." },
        ],
      })),
      createdAt: "2026-09-21T00:00:00.000Z",
      updatedAt: "2026-09-21T00:00:00.000Z",
    };
    const compiled = prepareWritingEvaluation({
      document,
      rubric,
      intent: {
        documentVersion: 0,
        rubricId: rubric.id,
        rubricRevision: 1,
        scope: { kind: "document" },
        languageHint: "unspecified",
      },
      providerId: "mock",
      endpointIdentity: "mock://local",
      requestedModel: "mock-writing-fixtures-v1",
    }).compiled;
    const response = await new MockWritingEvaluator().evaluate(
      compiled,
      new AbortController().signal,
    );
    expect(response.model).toBe("mock-writing-fixtures-v1");
    expect(
      response.answers[compiled.criterionMapping[0]!.scoreKey],
    ).toMatchObject({
      type: "score",
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
    });
    const result = deriveWritingEvaluationResult(compiled, response);
    expect(result.criteria.map(({ status }) => status)).toEqual([
      "assessed",
      "needs_context",
      "not_applicable",
      "uncertain_assessability",
      "assessed",
      "assessed",
    ]);
    expect(result.criteria[4]).toMatchObject({ mixed: true });
    expect(result.criteria[5]).toMatchObject({
      mixed: false,
      primaryLevel: 0,
    });
  });
});
