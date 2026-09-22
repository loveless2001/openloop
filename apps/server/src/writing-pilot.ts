import { createHash, randomUUID } from "node:crypto";
import {
  deriveWritingEvaluationResult,
  prepareWritingEvaluation,
} from "@openloop/core";
import {
  WritingEvaluatorError,
  type WritingEvaluator,
} from "@openloop/model-adapters";
import {
  WritingEvaluationExportSchema,
  WritingPilotFixtureSchema,
  WRITING_EVALUATION_ASSESSABILITY_THRESHOLD,
  WRITING_EVALUATION_LEVEL_THRESHOLD,
  type WritingEvaluationExport,
} from "@openloop/shared";

function stableId(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function prepareWritingPilot(
  input: unknown,
  provider: {
    providerId: "mock" | "typesafe";
    requestedModel: string;
    endpointIdentity: string;
  },
) {
  const fixture = WritingPilotFixtureSchema.parse(input);
  return fixture.pairs.flatMap((pair) =>
    pair.variants.map((variant) => {
      const documentId = stableId(`${fixture.id}/${pair.id}/document`);
      const targetNodeId = stableId(`${documentId}/target`);
      const paragraph = (text: string, nodeId: string) => ({
        type: "paragraph",
        attrs: { nodeId },
        content: [{ type: "text", text }],
      });
      const rubric = fixture.rubrics.find(
        (entry) => entry.id === variant.rubricId,
      )!;
      const { compiled, preview } = prepareWritingEvaluation({
        document: {
          id: documentId,
          title: pair.id,
          version: 0,
          plainText: "",
          createdAt: rubric.createdAt,
          updatedAt: rubric.updatedAt,
          contentJson: {
            type: "doc",
            content: [
              ...(variant.contextBefore
                ? [
                    paragraph(
                      variant.contextBefore,
                      stableId(`${documentId}/before`),
                    ),
                  ]
                : []),
              paragraph(variant.targetText, targetNodeId),
              ...(variant.contextAfter
                ? [
                    paragraph(
                      variant.contextAfter,
                      stableId(`${documentId}/after`),
                    ),
                  ]
                : []),
            ],
          },
        },
        rubric,
        intent: {
          documentVersion: 0,
          rubricId: rubric.id,
          rubricRevision: rubric.revision,
          languageHint: variant.languageHint,
          scope:
            variant.scope === "document"
              ? { kind: "document" }
              : {
                  kind: "selection",
                  contextMode:
                    variant.contextBefore || variant.contextAfter
                      ? "nearby"
                      : "none",
                  fragments: [
                    {
                      nodeId: targetNodeId,
                      nodeType: "paragraph",
                      headingPath: [],
                      text: variant.targetText,
                      selectionStart: 0,
                      selectionEnd: variant.targetText.length,
                    },
                  ],
                },
        },
        ...provider,
      });
      return {
        fixtureId: fixture.id,
        pairId: pair.id,
        variantId: variant.id,
        hypothesis: pair.hypothesis,
        compiled,
        preview,
      };
    }),
  );
}

export interface WritingPilotRecord {
  schemaVersion: "writing-pilot-result.v1";
  fixtureSha256: string;
  fixtureId: string;
  pairId: string;
  variantId: string;
  hypothesis: string;
  hypothesisStatus: "author_reviewable_not_ground_truth";
  preparedBytes: number;
  evaluation: WritingEvaluationExport;
}

export async function runWritingPilot(options: {
  prepared: ReturnType<typeof prepareWritingPilot>;
  evaluator: WritingEvaluator;
  fixtureSha256: string;
  allowRemote: boolean;
  write: (record: WritingPilotRecord) => Promise<void>;
}): Promise<{ completed: number; failed: number; unattempted: number }> {
  if (options.evaluator.providerId === "typesafe" && !options.allowRemote) {
    throw new Error(
      "Remote pilots require --provider typesafe --allow-remote.",
    );
  }
  if (
    options.prepared.some(
      (entry) => entry.preview.providerId !== options.evaluator.providerId,
    )
  ) {
    throw new Error("The evaluator must match the prepared provider.");
  }
  let completed = 0;
  let failed = 0;
  for (const entry of options.prepared) {
    const { compiled, preview } = entry;
    const createdAt = new Date().toISOString();
    const startedAt = Date.now();
    const providerCalled = compiled.criterionMapping.length > 0;
    let result;
    let response;
    let failure;
    try {
      response = providerCalled
        ? await options.evaluator.evaluate(
            compiled,
            new AbortController().signal,
          )
        : undefined;
      result = deriveWritingEvaluationResult(compiled, response);
      completed += 1;
    } catch (error) {
      failure =
        error instanceof WritingEvaluatorError
          ? { code: error.code, message: error.message }
          : {
              code: "EVALUATOR_INVALID_RESPONSE",
              message: "The evaluator did not return a valid assessment.",
            };
      failed += 1;
    }
    const now = new Date().toISOString();
    const evaluation = WritingEvaluationExportSchema.parse({
      schemaVersion: "writing-evaluation-export.v1",
      exportedAt: now,
      sourceTextWarning:
        "Contains the evaluated source text, context, rubric, and author comments.",
      signalProvenance: {
        assessment:
          preview.providerId === "mock" ? "mock_fixture" : "model_assessment",
        feedback: "author_feedback_not_verified_ground_truth",
      },
      policy: {
        version: compiled.snapshot.policyVersion,
        assessabilityThreshold: WRITING_EVALUATION_ASSESSABILITY_THRESHOLD,
        levelThreshold: WRITING_EVALUATION_LEVEL_THRESHOLD,
      },
      feedback: [],
      run: {
        id: randomUUID(),
        requestId: randomUUID(),
        documentId: compiled.snapshot.documentId,
        documentVersion: compiled.snapshot.documentVersion,
        rubricId: compiled.snapshot.rubricSnapshot.id,
        rubricRevision: compiled.snapshot.rubricSnapshot.revision,
        inputHash: compiled.snapshot.inputHash,
        providerId: preview.providerId,
        requestedModel: preview.requestedModel,
        ...(response
          ? { returnedModel: response.model, usage: response.usage }
          : providerCalled
            ? {}
            : { usage: { inputTokens: 0, outputTokens: 0 } }),
        status: failure ? "failed" : "completed",
        providerCalled,
        snapshot: compiled.snapshot,
        compiledRequest: compiled.request,
        result,
        failure,
        durationMs: Date.now() - startedAt,
        createdAt,
        updatedAt: now,
        completedAt: now,
      },
    });
    await options.write({
      schemaVersion: "writing-pilot-result.v1",
      fixtureSha256: options.fixtureSha256,
      fixtureId: entry.fixtureId,
      pairId: entry.pairId,
      variantId: entry.variantId,
      hypothesis: entry.hypothesis,
      hypothesisStatus: "author_reviewable_not_ground_truth",
      preparedBytes: preview.byteCount,
      evaluation,
    });
    // A failed call stops the batch. Resumption requires a new explicit invocation.
    if (failure) break;
  }
  return {
    completed,
    failed,
    unattempted: options.prepared.length - completed - failed,
  };
}
