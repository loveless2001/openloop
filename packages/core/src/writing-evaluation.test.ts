import type {
  DocumentRecord,
  WritingEvaluatorResponse,
  WritingRubric,
} from "@openloop/shared";
import { describe, expect, it } from "vitest";

import {
  deriveWritingEvaluationResult,
  evaluationDocumentText,
  prepareWritingEvaluation,
  WritingEvaluationPreparationError,
} from "./writing-evaluation.js";

const paragraphOne = "11111111-1111-4111-8111-111111111111";
const paragraphTwo = "22222222-2222-4222-8222-222222222222";
const codeBlockId = "88888888-8888-4888-8888-888888888888";
const rubricId = "33333333-3333-4333-8333-333333333333";
const criterionOne = "44444444-4444-4444-8444-444444444444";
const criterionTwo = "55555555-5555-4555-8555-555555555555";

function document(contentJson: DocumentRecord["contentJson"]): DocumentRecord {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    title: "Draft",
    contentJson,
    plainText: "",
    version: 4,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
}

function rubric(): WritingRubric {
  const levels: WritingRubric["criteria"][number]["levels"] = [
    { label: "Low", description: "The goal is not met." },
    { label: "Some", description: "The goal is partly met." },
    { label: "Strong", description: "The goal is clearly met." },
  ];
  return {
    id: rubricId,
    revision: 2,
    title: "Goals",
    purpose: "Explain",
    audience: "Readers",
    criteria: [
      {
        id: criterionOne,
        name: "Clarity",
        question: "Is it clear?",
        allowedScopes: ["selection", "document"],
        levels: structuredClone(levels),
      },
      {
        id: criterionTwo,
        name: "Whole-draft structure",
        question: "Is the whole draft coherent?",
        allowedScopes: ["document"],
        levels: structuredClone(levels),
      },
    ],
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
  };
}

const nestedContent = {
  type: "doc",
  content: [
    {
      type: "blockquote",
      attrs: { nodeId: "77777777-7777-4777-8777-777777777777" },
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: paragraphOne },
          content: [{ type: "text", text: "Quoted once" }],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: paragraphTwo },
              content: [
                { type: "text", text: "Việt" },
                { type: "hardBreak" },
                { type: "text", text: "Nam" },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "codeBlock",
      attrs: { nodeId: codeBlockId },
      content: [{ type: "text", text: "const x = 1;" }],
    },
  ],
} as DocumentRecord["contentJson"];

describe("writing evaluation preparation", () => {
  it("serializes nested quotes, lists, and hard breaks once in document order", () => {
    expect(evaluationDocumentText(nestedContent)).toBe(
      "Quoted once\nViệt\nNam\nconst x = 1;",
    );
  });

  it("validates exact UTF-16 selection fragments across nodes and clips context", () => {
    const prepared = prepareWritingEvaluation({
      document: document(nestedContent),
      rubric: rubric(),
      intent: {
        documentVersion: 4,
        rubricId,
        rubricRevision: 2,
        scope: {
          kind: "selection",
          contextMode: "nearby",
          fragments: [
            {
              nodeId: paragraphOne,
              nodeType: "paragraph",
              text: "once",
              headingPath: [],
              selectionStart: 7,
              selectionEnd: 11,
            },
            {
              nodeId: paragraphTwo,
              nodeType: "paragraph",
              text: "Việt",
              headingPath: [],
              selectionStart: 0,
              selectionEnd: 4,
            },
          ],
        },
        languageHint: "vi",
      },
      providerId: "mock",
      endpointIdentity: "mock://local",
      requestedModel: "mock-writing-fixtures-v1",
    });
    expect(prepared.preview.snapshot.targetText).toBe("once\nViệt");
    expect(prepared.preview.snapshot.context.before).toBe("Quoted ");
    expect(prepared.preview.snapshot.context.after).toBe("\nNam\nconst x = 1;");
    expect(Object.keys(prepared.compiled.request.questions)).toEqual([
      `criterion_${criterionOne.replaceAll("-", "_")}__score`,
      `criterion_${criterionOne.replaceAll("-", "_")}__assessability`,
    ]);
    expect(prepared.compiled.request).toMatchObject({
      model: "mock-writing-fixtures-v1",
      state: {
        target: { scope: "selection", text: "once\nViệt" },
        context: { before: "Quoted ", after: "\nNam\nconst x = 1;" },
        writing_goal: { purpose: "Explain", audience: "Readers" },
        language_hint: "vi",
      },
      questions: {
        [`criterion_${criterionOne.replaceAll("-", "_")}__score`]: {
          type: "score",
          criteria: [
            "The goal is not met.",
            "The goal is partly met.",
            "The goal is clearly met.",
          ],
        },
        [`criterion_${criterionOne.replaceAll("-", "_")}__assessability`]: {
          type: "choice",
          criteria: {
            assessable: expect.any(String),
            needs_context: expect.any(String),
            not_applicable: expect.any(String),
          },
        },
      },
    });
    expect(prepared.compiled.request).not.toHaveProperty("messages");
    expect(prepared.compiled.incompatibleCriterionIds).toEqual([criterionTwo]);
  });

  it("extracts one canonical range across empty paragraphs and partial boundary blocks", () => {
    const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const emptyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const lastId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: firstId },
          content: [{ type: "text", text: "alpha" }],
        },
        { type: "paragraph", attrs: { nodeId: emptyId } },
        {
          type: "paragraph",
          attrs: { nodeId: lastId },
          content: [{ type: "text", text: "bravo" }],
        },
      ],
    } as DocumentRecord["contentJson"];
    const prepared = prepareWritingEvaluation({
      document: document(content),
      rubric: rubric(),
      intent: {
        documentVersion: 4,
        rubricId,
        rubricRevision: 2,
        scope: {
          kind: "selection",
          contextMode: "nearby",
          fragments: [
            {
              nodeId: firstId,
              nodeType: "paragraph",
              text: "pha",
              headingPath: [],
              selectionStart: 2,
              selectionEnd: 5,
            },
            {
              nodeId: lastId,
              nodeType: "paragraph",
              text: "bra",
              headingPath: [],
              selectionStart: 0,
              selectionEnd: 3,
            },
          ],
        },
        languageHint: "en",
      },
      providerId: "mock",
      endpointIdentity: "mock://local",
      requestedModel: "mock-writing-fixtures-v1",
    });

    expect(prepared.preview.snapshot.targetText).toBe("pha\n\nbra");
    expect(prepared.preview.snapshot.context).toMatchObject({
      before: "al",
      after: "vo",
    });
  });

  it("makes a whole-range selection byte-for-byte equal to canonical nested text", () => {
    const canonical = evaluationDocumentText(nestedContent);
    const prepared = prepareWritingEvaluation({
      document: document(nestedContent),
      rubric: rubric(),
      intent: {
        documentVersion: 4,
        rubricId,
        rubricRevision: 2,
        scope: {
          kind: "selection",
          contextMode: "nearby",
          fragments: [
            {
              nodeId: paragraphOne,
              nodeType: "paragraph",
              text: "Quoted once",
              headingPath: [],
              selectionStart: 0,
              selectionEnd: 11,
            },
            {
              nodeId: paragraphTwo,
              nodeType: "paragraph",
              text: "Việt\nNam",
              headingPath: [],
              selectionStart: 0,
              selectionEnd: 8,
            },
            {
              nodeId: codeBlockId,
              nodeType: "codeBlock",
              text: "const x = 1;",
              headingPath: [],
              selectionStart: 0,
              selectionEnd: 12,
            },
          ],
        },
        languageHint: "vi",
      },
      providerId: "mock",
      endpointIdentity: "mock://local",
      requestedModel: "mock-writing-fixtures-v1",
    });

    expect(prepared.preview.snapshot.targetText).toBe(canonical);
    expect(prepared.preview.snapshot.context).toMatchObject({
      before: "",
      after: "",
    });
  });

  it("preserves UTF-16 emoji and Vietnamese combining marks without normalization", () => {
    const text = "😀 Vie\u0323\u0302t";
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: paragraphOne },
          content: [{ type: "text", text }],
        },
      ],
    } as DocumentRecord["contentJson"];
    const selected = text.slice(0, text.length - 1);
    const prepared = prepareWritingEvaluation({
      document: document(content),
      rubric: rubric(),
      intent: {
        documentVersion: 4,
        rubricId,
        rubricRevision: 2,
        scope: {
          kind: "selection",
          contextMode: "none",
          fragments: [
            {
              nodeId: paragraphOne,
              nodeType: "paragraph",
              text: selected,
              headingPath: [],
              selectionStart: 0,
              selectionEnd: selected.length,
            },
          ],
        },
        languageHint: "vi",
      },
      providerId: "mock",
      endpointIdentity: "mock://local",
      requestedModel: "mock-writing-fixtures-v1",
    });

    expect(prepared.preview.snapshot.targetText).toBe(selected);
    expect(prepared.preview.snapshot.targetText).not.toBe(
      selected.normalize("NFC"),
    );
  });

  it("rejects incomplete cross-block ranges instead of dropping intervening text", () => {
    expect(() =>
      prepareWritingEvaluation({
        document: document(nestedContent),
        rubric: rubric(),
        intent: {
          documentVersion: 4,
          rubricId,
          rubricRevision: 2,
          scope: {
            kind: "selection",
            contextMode: "none",
            fragments: [
              {
                nodeId: paragraphOne,
                nodeType: "paragraph",
                text: "Quoted",
                headingPath: [],
                selectionStart: 0,
                selectionEnd: 6,
              },
              {
                nodeId: paragraphTwo,
                nodeType: "paragraph",
                text: "Việt",
                headingPath: [],
                selectionStart: 0,
                selectionEnd: 4,
              },
            ],
          },
          languageHint: "en",
        },
        providerId: "mock",
        endpointIdentity: "mock://local",
        requestedModel: "mock-writing-fixtures-v1",
      }),
    ).toThrow("one exact contiguous range");
  });

  it("rejects unsupported text nodes instead of silently omitting them", () => {
    const unsupported = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: paragraphOne },
          content: [{ type: "text", text: "before" }],
        },
        {
          type: "unsupportedCallout",
          content: [{ type: "text", text: "must not disappear" }],
        },
      ],
    } as DocumentRecord["contentJson"];
    expect(() => evaluationDocumentText(unsupported)).toThrow(
      "unsupported text",
    );
  });

  it("fails closed when a selection no longer matches canonical saved text", () => {
    expect(() =>
      prepareWritingEvaluation({
        document: document(nestedContent),
        rubric: rubric(),
        intent: {
          documentVersion: 4,
          rubricId,
          rubricRevision: 2,
          scope: {
            kind: "selection",
            contextMode: "none",
            fragments: [
              {
                nodeId: paragraphOne,
                nodeType: "paragraph",
                text: "wrong",
                headingPath: [],
                selectionStart: 0,
                selectionEnd: 5,
              },
            ],
          },
          languageHint: "en",
        },
        providerId: "mock",
        endpointIdentity: "mock://local",
        requestedModel: "mock-writing-fixtures-v1",
      }),
    ).toThrow(WritingEvaluationPreparationError);
  });

  it("keeps timestamps outside the semantic input hash", () => {
    const base = rubric();
    const prepare = (rubricSnapshot: WritingRubric) =>
      prepareWritingEvaluation({
        document: document(nestedContent),
        rubric: rubricSnapshot,
        intent: {
          documentVersion: 4,
          rubricId,
          rubricRevision: 2,
          scope: { kind: "document" },
          languageHint: "en",
        },
        providerId: "mock",
        endpointIdentity: "mock://local",
        requestedModel: "mock-writing-fixtures-v1",
      }).preview.inputHash;
    expect(
      prepare({
        ...base,
        createdAt: "2030-01-01T00:00:00.000Z",
        updatedAt: "2030-01-02T00:00:00.000Z",
      }),
    ).toBe(prepare(base));
  });
});

describe("writing evaluation display policy", () => {
  it("separates poor assessment, missing context, uncertain assessability, and mixed score", () => {
    const compiled = prepareWritingEvaluation({
      document: document(nestedContent),
      rubric: {
        ...rubric(),
        criteria: rubric().criteria.map((criterion) => ({
          ...criterion,
          allowedScopes: ["document"],
        })),
      },
      intent: {
        documentVersion: 4,
        rubricId,
        rubricRevision: 2,
        scope: { kind: "document" },
        languageHint: "en",
      },
      providerId: "mock",
      endpointIdentity: "mock://local",
      requestedModel: "mock-writing-fixtures-v1",
    }).compiled;
    const [first, second] = compiled.criterionMapping;
    expect(first && second).toBeTruthy();
    const response: WritingEvaluatorResponse = {
      model: "fixture-v1",
      answers: {
        [first!.scoreKey]: {
          type: "score",
          score: 0.3,
          probabilities: { "0": 0.8, "1": 0.1, "2": 0.1 },
          legend: {
            "0": "The goal is not met.",
            "1": "The goal is partly met.",
            "2": "The goal is clearly met.",
          },
          confidence: 0.7,
        },
        [first!.assessabilityKey]: {
          type: "choice",
          choice: "assessable",
          probabilities: {
            assessable: 0.9,
            needs_context: 0.05,
            not_applicable: 0.05,
          },
          confidence: 0.8,
        },
        [second!.scoreKey]: {
          type: "score",
          score: 1,
          probabilities: { "0": 0.45, "1": 0.1, "2": 0.45 },
          legend: {
            "0": "The goal is not met.",
            "1": "The goal is partly met.",
            "2": "The goal is clearly met.",
          },
          confidence: 0.1,
        },
        [second!.assessabilityKey]: {
          type: "choice",
          choice: "needs_context",
          probabilities: {
            assessable: 0.1,
            needs_context: 0.8,
            not_applicable: 0.1,
          },
          confidence: 0.7,
        },
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    const result = deriveWritingEvaluationResult(compiled, response);
    expect(result.criteria[0]).toMatchObject({
      status: "assessed",
      primaryLevel: 0,
      mixed: false,
    });
    expect(result.criteria[1]).toMatchObject({
      status: "needs_context",
      mixed: false,
    });
    expect(result).not.toHaveProperty("aggregateScore");
  });
});
