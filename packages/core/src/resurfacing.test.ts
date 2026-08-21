import type { TextBlockSnapshot } from "@openloop/shared";
import { describe, expect, it } from "vitest";

import type { IssueRecord } from "./issues.js";
import {
  ISSUE_BASE_COOLDOWN_MS,
  rankResurfaceIssues,
  selectResurfaceIssue,
} from "./resurfacing.js";

const now = new Date("2026-08-21T12:00:00.000Z");
const attention = {
  userIdleMs: 1_200,
  completionVisible: false,
  issueCardExpanded: false,
};
const anchorNodeId = "51ec4dfc-ce05-4111-be2e-bcbe632b18ea";
const changedNodeId = "fb12bf9f-d5c5-4b01-81e2-3cf1ef83eeaa";

function issue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: "0d09aa01-70fa-4507-9dfa-46ae57ce53c4",
    documentId: "4bd41f6e-a0f5-48a1-b4bb-d31b55f662f4",
    type: "ambiguity",
    status: "open",
    question: "Are interface compatibility and model quality equivalent?",
    rationale: "Compatibility and quality differ.",
    severity: 4,
    confidence: 0.98,
    interruptWorthiness: 0.95,
    anchor: {
      nodeId: anchorNodeId,
      quote: "model interface quality",
      leftContext: "",
      rightContext: "",
      normalizedFingerprint: "a".repeat(64),
      sourceDocumentVersion: 1,
      detached: false,
    },
    keywords: ["model", "interface", "quality"],
    resurfaceTriggers: ["claim_reused", "section_end"],
    dedupeKey: "b".repeat(64),
    shownCount: 1,
    silentIgnoreCount: 0,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function block(text: string): TextBlockSnapshot {
  return {
    nodeId: changedNodeId,
    nodeType: "paragraph",
    text,
    headingPath: ["Conclusion"],
  };
}

describe("resurfacing scheduler", () => {
  it("selects the same issue when a different block reuses its claim", () => {
    const selected = selectResurfaceIssue({
      issues: [issue()],
      trigger: "claim_reused",
      changedBlocks: [
        block("The model interface therefore guarantees equivalent quality."),
      ],
      documentVersion: 4,
      now,
      attention,
    });

    expect(selected?.issue.id).toBe(issue().id);
  });

  it("fails eligibility during cooldown and for a detached anchor", () => {
    const recent = new Date(
      now.getTime() - ISSUE_BASE_COOLDOWN_MS + 1,
    ).toISOString();
    const baseInput = {
      trigger: "claim_reused" as const,
      changedBlocks: [
        block("The model interface therefore guarantees equivalent quality."),
      ],
      documentVersion: 4,
      now,
      attention,
    };
    expect(
      selectResurfaceIssue({
        ...baseInput,
        issues: [issue({ lastShownAt: recent })],
      }),
    ).toBeUndefined();
    expect(
      selectResurfaceIssue({
        ...baseInput,
        issues: [issue({ anchor: { ...issue().anchor, detached: true } })],
      }),
    ).toBeUndefined();
  });

  it("enforces idle, completion, and expanded-card attention gates", () => {
    const input = {
      issues: [issue()],
      trigger: "claim_reused" as const,
      changedBlocks: [
        block("The model interface therefore guarantees equivalent quality."),
      ],
      documentVersion: 4,
      now,
    };
    expect(
      selectResurfaceIssue({
        ...input,
        attention: { ...attention, userIdleMs: 1_199 },
      }),
    ).toBeUndefined();
    expect(
      selectResurfaceIssue({
        ...input,
        attention: { ...attention, completionVisible: true },
      }),
    ).toBeUndefined();
    expect(
      selectResurfaceIssue({
        ...input,
        attention: { ...attention, issueCardExpanded: true },
      }),
    ).toBeUndefined();
  });

  it("does not show an issue twice for the same document version", () => {
    const selected = selectResurfaceIssue({
      issues: [issue()],
      trigger: "claim_reused",
      changedBlocks: [
        block("The model interface therefore guarantees equivalent quality."),
      ],
      documentVersion: 4,
      now,
      attention,
      lastShownDocumentVersion: new Map([[issue().id, 4]]),
    });
    expect(selected).toBeUndefined();
  });

  it("selects an issue in the section being left", () => {
    const selected = selectResurfaceIssue({
      issues: [issue()],
      trigger: "section_end",
      changedBlocks: [
        {
          ...block("Conclusion"),
          nodeType: "heading",
          headingPath: ["Conclusion"],
        },
      ],
      documentVersion: 4,
      now,
      attention,
      issueHeadingPaths: new Map([[issue().id, ["Argument"]]]),
    });
    expect(selected?.issue.id).toBe(issue().id);
  });

  it("allows manual review after the automatic-show cap", () => {
    const selected = selectResurfaceIssue({
      issues: [issue({ shownCount: 3, lastShownAt: now.toISOString() })],
      trigger: "manual_review",
      changedBlocks: [],
      documentVersion: 4,
      now,
      attention,
    });
    expect(selected?.issue.id).toBe(issue().id);
  });

  it("allows severity escalation after the automatic-show cap", () => {
    const capped = issue({
      shownCount: 3,
      resurfaceTriggers: ["severity_escalated"],
    });
    const selected = selectResurfaceIssue({
      issues: [capped],
      trigger: "severity_escalated",
      changedBlocks: [],
      candidateIssueId: capped.id,
      documentVersion: 4,
      now,
      attention,
    });
    expect(selected?.issue.id).toBe(capped.id);
  });

  it("ranks by score, severity, then oldest creation time", () => {
    const higher = issue({
      id: "c1de4b2a-f0d7-4392-a564-c218e8729994",
      severity: 5,
      createdAt: "2026-08-19T00:00:00.000Z",
    });
    const ranked = rankResurfaceIssues({
      issues: [issue(), higher],
      trigger: "manual_review",
      changedBlocks: [],
      documentVersion: 4,
      now,
      attention,
    });
    expect(ranked[0]?.issue.id).toBe(higher.id);
  });
});
