import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MockWritingEvaluator,
  WritingEvaluatorError,
  type WritingEvaluator,
} from "@openloop/model-adapters";
import {
  WritingEvaluationExportSchema,
  WritingPilotFixtureSchema,
} from "@openloop/shared";
import { describe, expect, it, vi } from "vitest";

import { findWorkspaceRoot } from "./config/workspace.js";
import {
  prepareWritingPilot,
  runWritingPilot,
  type WritingPilotRecord,
} from "./writing-pilot.js";

const fixture = () =>
  WritingPilotFixtureSchema.parse(
    JSON.parse(
      readFileSync(
        resolve(findWorkspaceRoot(), "docs/fixtures/jev-writing-pilot.json"),
        "utf8",
      ),
    ),
  );
const mockConfig = {
  providerId: "mock" as const,
  requestedModel: "mock-writing-fixtures-v1",
  endpointIdentity: "mock://local",
};

describe("Jev pilot", () => {
  it("preserves paired provenance, repeated input hashes, context, and separate signal labels", async () => {
    const prepared = prepareWritingPilot(fixture(), mockConfig);
    const records: WritingPilotRecord[] = [];
    const summary = await runWritingPilot({
      prepared,
      evaluator: new MockWritingEvaluator(),
      fixtureSha256: "a".repeat(64),
      allowRemote: false,
      write: async (record) => {
        records.push(record);
      },
    });
    expect(summary).toEqual({ completed: 16, failed: 0, unattempted: 0 });
    for (const record of records) {
      expect(
        WritingEvaluationExportSchema.safeParse(record.evaluation).success,
      ).toBe(true);
      expect(record.evaluation.signalProvenance.assessment).toBe(
        "mock_fixture",
      );
      expect(record.hypothesisStatus).toBe(
        "author_reviewable_not_ground_truth",
      );
      expect(record.evaluation.feedback).toEqual([]);
      expect(record.evaluation.run.usage).toBeDefined();
    }
    const repeated = records.filter(
      (record) => record.pairId === "repeat-pinned-input",
    );
    expect(repeated[0]!.evaluation.run.inputHash).toBe(
      repeated[1]!.evaluation.run.inputHash,
    );
    expect(repeated[0]!.evaluation.run.id).not.toBe(
      repeated[1]!.evaluation.run.id,
    );
    const context = records.find(
      (record) =>
        record.pairId === "necessary-context" && record.variantId === "with",
    )!;
    expect(context.evaluation.run.snapshot.context.before).toContain("Mức A");
    expect(context.evaluation.run.snapshot.languageHint).toBe("vi");
    const incompatible = records[0]!.evaluation.run.result!.criteria.find(
      (entry) => entry.status === "incompatible_scope",
    )!;
    expect(incompatible).not.toHaveProperty("score");
  });

  it("preflights every fixture and rejects oversize or ambiguous input before evaluation", () => {
    const invalid = fixture();
    invalid.pairs[7]!.variants[1].targetText = "x".repeat(25_000);
    expect(() => prepareWritingPilot(invalid, mockConfig)).toThrow(
      "24,000-byte",
    );
    const unknown = fixture();
    unknown.pairs[0]!.variants[0].rubricId = crypto.randomUUID();
    expect(() => prepareWritingPilot(unknown, mockConfig)).toThrow();
    const wrongScope = fixture();
    wrongScope.pairs[0]!.variants[0].scope = "document";
    wrongScope.pairs[0]!.variants[0].contextBefore = "Should not be ignored";
    expect(() => prepareWritingPilot(wrongScope, mockConfig)).toThrow();
  });

  it("requires remote opt-in and stops after one failure, preserving a sanitized error record", async () => {
    const evaluate = vi.fn(async () => {
      throw new WritingEvaluatorError(
        "EVALUATOR_AUTH",
        "TypeSafe authentication failed.",
      );
    });
    const evaluator: WritingEvaluator = { providerId: "typesafe", evaluate };
    const prepared = prepareWritingPilot(fixture(), {
      providerId: "typesafe",
      requestedModel: "pinned-test-model",
      endpointIdentity: "https://example.test/v1/systemone",
    });
    const records: WritingPilotRecord[] = [];
    const options = {
      prepared,
      evaluator,
      fixtureSha256: "b".repeat(64),
      write: async (record: WritingPilotRecord) => {
        records.push(record);
      },
    };
    await expect(
      runWritingPilot({ ...options, allowRemote: false }),
    ).rejects.toThrow("--allow-remote");
    expect(evaluate).not.toHaveBeenCalled();
    expect(await runWritingPilot({ ...options, allowRemote: true })).toEqual({
      completed: 0,
      failed: 1,
      unattempted: 15,
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(records[0]!.evaluation.run.failure?.code).toBe("EVALUATOR_AUTH");
    expect(records[0]!.evaluation.run.result).toBeUndefined();
    expect(records[0]!.evaluation.run.usage).toBeUndefined();
  });
});
