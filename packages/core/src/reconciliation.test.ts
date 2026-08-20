import type { TextBlockSnapshot } from "@openloop/shared";
import { describe, expect, it } from "vitest";

import type { IssueRecord } from "./issues.js";
import {
  applyReconciliationResult,
  remapIssueAnchor,
} from "./reconciliation.js";

const nodeA = "51ec4dfc-ce05-4111-be2e-bcbe632b18ea";
const nodeB = "fb12bf9f-d5c5-4b01-81e2-3cf1ef83eeaa";
const quote = "any model will work equally well";
const originalText = `The claim that ${quote} needs support.`;

const issue: IssueRecord = {
  id: "0d09aa01-70fa-4507-9dfa-46ae57ce53c4",
  documentId: "4bd41f6e-a0f5-48a1-b4bb-d31b55f662f4",
  type: "ambiguity",
  status: "open",
  question: "Do you mean the models have equal quality?",
  rationale: "Compatibility and quality differ.",
  severity: 4,
  confidence: 0.98,
  interruptWorthiness: 0.95,
  anchor: {
    nodeId: nodeA,
    quote,
    quoteStart: originalText.indexOf(quote),
    quoteEnd: originalText.indexOf(quote) + quote.length,
    leftContext: "The claim that ",
    rightContext: " needs support.",
    normalizedFingerprint: "a".repeat(64),
    sourceDocumentVersion: 1,
    detached: false,
  },
  keywords: ["model", "quality"],
  resurfaceTriggers: ["claim_reused"],
  dedupeKey: "b".repeat(64),
  shownCount: 1,
  silentIgnoreCount: 0,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

function block(
  nodeId: string,
  text: string,
  headingPath: string[] = ["Argument"],
): TextBlockSnapshot {
  return { nodeId, nodeType: "paragraph", text, headingPath };
}

const now = new Date("2026-08-20T00:00:00.000Z");

describe("anchor reconciliation", () => {
  it("updates offsets for an exact anchor in the same node", () => {
    const currentText = `Added context. ${originalText}`;
    const result = remapIssueAnchor({
      issue,
      previousBlocks: [block(nodeA, originalText)],
      currentBlocks: [block(nodeA, currentText)],
      mergedNodeMap: {},
      documentVersion: 2,
      now,
    });

    expect(result.kind).toBe("exact");
    expect(result.issue.anchor).toMatchObject({
      nodeId: nodeA,
      quoteStart: currentText.indexOf(quote),
      detached: false,
      sourceDocumentVersion: 2,
    });
  });

  it("fuzzily remaps a slightly changed quote in the same node", () => {
    const revisedQuote = "any model can work equally well";
    const result = remapIssueAnchor({
      issue,
      previousBlocks: [block(nodeA, originalText)],
      currentBlocks: [
        block(nodeA, `The claim that ${revisedQuote} needs support.`),
      ],
      mergedNodeMap: {},
      documentVersion: 2,
      now,
    });

    expect(result.kind).toBe("remapped");
    expect(result.score).toBeGreaterThanOrEqual(0.82);
    expect(result.issue.anchor.quote).toBe(revisedQuote);
  });

  it("remaps an anchor into the surviving merged node", () => {
    const result = remapIssueAnchor({
      issue,
      previousBlocks: [block(nodeA, originalText), block(nodeB, "Next block")],
      currentBlocks: [block(nodeB, `Preface. ${originalText} Next block`)],
      mergedNodeMap: { [nodeA]: nodeB },
      documentVersion: 2,
      now,
    });

    expect(result.kind).toBe("remapped");
    expect(result.issue.anchor).toMatchObject({
      nodeId: nodeB,
      detached: false,
    });
  });

  it("recovers a moved anchor from a bounded same-heading neighbor", () => {
    const result = remapIssueAnchor({
      issue,
      previousBlocks: [block(nodeA, originalText), block(nodeB, "Next block")],
      currentBlocks: [block(nodeB, originalText)],
      mergedNodeMap: {},
      documentVersion: 2,
      now,
    });

    expect(result.kind).toBe("remapped");
    expect(result.score).toBeGreaterThanOrEqual(0.86);
    expect(result.issue.anchor.nodeId).toBe(nodeB);
  });

  it("detaches an anchor when no bounded candidate is similar enough", () => {
    const result = remapIssueAnchor({
      issue,
      previousBlocks: [block(nodeA, originalText)],
      currentBlocks: [block(nodeB, "A completely unrelated replacement.")],
      mergedNodeMap: {},
      documentVersion: 2,
      now,
    });

    expect(result.kind).toBe("detached");
    expect(result.needsReconciliation).toBe(true);
    expect(result.issue).toMatchObject({
      status: "needs_review",
      anchor: { detached: true },
    });
  });

  it("maps reconciliation outcomes and protects low-confidence severity five", () => {
    const resolved = applyReconciliationResult({
      issue,
      result: {
        outcome: "resolved",
        reason: "The distinction is now explicit.",
        confidence: 0.9,
      },
      currentBlock: block(
        nodeA,
        "API-compatible models still differ in quality.",
      ),
      documentVersion: 2,
      now,
    });
    expect(resolved).toMatchObject({
      action: "reconciled_resolved",
      issue: { status: "resolved", resolvedAt: now.toISOString() },
    });

    const protectedResult = applyReconciliationResult({
      issue: { ...issue, severity: 5 },
      result: {
        outcome: "invalidated",
        reason: "The claim appears absent.",
        confidence: 0.69,
      },
      documentVersion: 2,
      now,
    });
    expect(protectedResult).toMatchObject({
      action: "reconciled_uncertain",
      issue: { status: "needs_review" },
    });
  });

  it("preserves an active snooze for a persisting remapped issue", () => {
    const revisedQuote = "models share an API but differ in quality";
    const result = applyReconciliationResult({
      issue: {
        ...issue,
        status: "snoozed",
        snoozedUntil: "2026-08-20T00:05:00.000Z",
        anchor: { ...issue.anchor, detached: true },
      },
      result: {
        outcome: "persists",
        reason: "The distinction is mentioned but not yet supported.",
        confidence: 0.88,
        newAnchorQuote: revisedQuote,
      },
      currentBlock: block(nodeB, `The draft says ${revisedQuote}.`),
      documentVersion: 3,
      now,
    });

    expect(result).toMatchObject({
      action: "reconciled_persists",
      issue: {
        status: "snoozed",
        anchor: { nodeId: nodeB, quote: revisedQuote, detached: false },
      },
    });
  });

  it("records a confident invalidation as terminal", () => {
    const result = applyReconciliationResult({
      issue,
      result: {
        outcome: "invalidated",
        reason: "The underlying claim no longer exists.",
        confidence: 0.9,
      },
      documentVersion: 3,
      now,
    });

    expect(result).toMatchObject({
      action: "reconciled_invalidated",
      issue: { status: "invalidated" },
    });
  });
});
