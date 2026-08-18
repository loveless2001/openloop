import { describe, expect, it } from "vitest";

import type { IssueRecord } from "./issues.js";
import {
  InvalidIssueTransitionError,
  normalizeIssueText,
  tokenJaccard,
  transitionIssue,
} from "./issues.js";

const issue: IssueRecord = {
  id: "0d09aa01-70fa-4507-9dfa-46ae57ce53c4",
  documentId: "4bd41f6e-a0f5-48a1-b4bb-d31b55f662f4",
  type: "ambiguity",
  status: "open",
  question: "Do you mean the models have equal quality?",
  rationale: "Compatibility and quality differ.",
  suggestedRewrite: "Models share an API but may differ in quality.",
  severity: 4,
  confidence: 0.98,
  interruptWorthiness: 0.95,
  anchor: {
    nodeId: "51ec4dfc-ce05-4111-be2e-bcbe632b18ea",
    quote: "any model will work equally well",
    leftContext: "",
    rightContext: "",
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

describe("issue domain", () => {
  it("normalizes text and computes deterministic token overlap", () => {
    expect(normalizeIssueText("  Model—QUALITY!  ")).toBe("model quality");
    expect(tokenJaccard("model API quality", "model quality")).toBeCloseTo(
      2 / 3,
    );
  });

  it("snoozes and resolves active issues", () => {
    const now = new Date("2026-08-18T01:00:00.000Z");
    const snoozed = transitionIssue(
      issue,
      {
        action: "snooze",
        snoozedUntil: new Date("2026-08-18T01:02:00.000Z"),
      },
      now,
    ).issue;
    expect(snoozed).toMatchObject({
      status: "snoozed",
      snoozedUntil: "2026-08-18T01:02:00.000Z",
    });
    expect(
      transitionIssue(snoozed, { action: "resolve" }, now).issue,
    ).toMatchObject({ status: "resolved", resolvedAt: now.toISOString() });
  });

  it("rejects invalid terminal transitions and permits explicit reopen", () => {
    const dismissed = { ...issue, status: "dismissed" as const };
    expect(() =>
      transitionIssue(dismissed, { action: "resolve" }, new Date()),
    ).toThrow(InvalidIssueTransitionError);
    expect(
      transitionIssue(dismissed, { action: "reopen" }, new Date()).issue.status,
    ).toBe("open");
  });
});
