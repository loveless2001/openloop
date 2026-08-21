// @vitest-environment happy-dom

import type { IssueRecord } from "@openloop/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { IssuePanel } from "./IssuePanel.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const issue: IssueRecord = {
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
    nodeId: "51ec4dfc-ce05-4111-be2e-bcbe632b18ea",
    quote: "model interface quality",
    leftContext: "",
    rightContext: "",
    normalizedFingerprint: "a".repeat(64),
    sourceDocumentVersion: 1,
    detached: false,
  },
  keywords: ["model", "interface", "quality"],
  resurfaceTriggers: ["manual_review"],
  dedupeKey: "b".repeat(64),
  shownCount: 1,
  silentIgnoreCount: 0,
  createdAt: "2026-08-21T12:00:00.000Z",
  updatedAt: "2026-08-21T12:00:00.000Z",
};

describe("IssuePanel manual review", () => {
  it("reviews when the Open filter is opened or the review button is clicked", async () => {
    const onManualReview = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(IssuePanel, {
          issues: [issue],
          onManualReview,
          onSelect: () => undefined,
        }),
      );
    });

    const button = (name: string) =>
      [...container.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === name,
      )!;
    await act(async () => button("resolved").click());
    await act(async () => button("open").click());
    expect(onManualReview).toHaveBeenCalledTimes(1);
    await act(async () => button("Review open loops").click());
    expect(onManualReview).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
  });
});
