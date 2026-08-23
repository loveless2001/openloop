// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ExportReviewDialog } from "./ExportReviewDialog.js";

describe("ExportReviewDialog", () => {
  it("lists blocking obligations and requires an explicit choice", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onCancel = vi.fn();
    const onExport = vi.fn();
    const now = new Date().toISOString();

    await act(async () => {
      root.render(
        createElement(ExportReviewDialog, {
          exporting: false,
          onCancel,
          onExport,
          review: {
            blockingIssues: [
              {
                id: "79e60dc4-22c8-41d9-99ee-295589685e85",
                documentId: "24f24853-23b0-4ca1-8c1f-2d0b6da77ae1",
                type: "ambiguity",
                status: "open",
                question: "Does API compatibility imply equal quality?",
                rationale: "The claims are distinct.",
                severity: 4,
                confidence: 0.98,
                interruptWorthiness: 0.95,
                anchor: {
                  nodeId: "7e7b19e4-f2c6-4a42-9f21-e62be93a3dbf",
                  quote: "any model works equally well",
                  leftContext: "",
                  rightContext: "",
                  normalizedFingerprint: "a".repeat(64),
                  sourceDocumentVersion: 0,
                  detached: false,
                },
                keywords: ["model", "quality"],
                resurfaceTriggers: ["claim_reused"],
                dedupeKey: "b".repeat(64),
                shownCount: 1,
                silentIgnoreCount: 0,
                createdAt: now,
                updatedAt: now,
              },
            ],
            openIssueCount: 2,
            needsReconciliation: false,
          },
        }),
      );
    });

    expect(container.textContent).toContain(
      "1 high-severity loop is still open",
    );
    expect(container.textContent).toContain(
      "Does API compatibility imply equal quality?",
    );
    const buttons = container.querySelectorAll("button");
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
