// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { IssueChatDrawer } from "./IssueChatDrawer.js";

const issue = {
  id: "ab9adf5e-03a8-4c8b-a15c-779478f9b228",
  documentId: "504c7d3d-b87f-4b05-a303-a7bab6099828",
  type: "evidence_gap" as const,
  status: "open" as const,
  question: "Which evidence supports this conclusion?",
  rationale: "Examples alone may not establish the general claim.",
  severity: 4 as const,
  confidence: 0.9,
  interruptWorthiness: 0.9,
  anchor: {
    nodeId: "24ed13e0-e0a8-4355-8f21-d8132558e008",
    quote: "every available example",
    leftContext: "",
    rightContext: "",
    normalizedFingerprint: "0".repeat(64),
    sourceDocumentVersion: 0,
    detached: false,
  },
  keywords: ["evidence"],
  resurfaceTriggers: ["claim_reused" as const],
  dedupeKey: "1".repeat(64),
  shownCount: 1,
  silentIgnoreCount: 0,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

describe("IssueChatDrawer", () => {
  it("supports one collapsible chat with attachments, send, and status actions", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const onCollapse = vi.fn();
    const onSend = vi.fn();
    const onAction = vi.fn();
    const onRemoveAttachment = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(IssueChatDrawer, {
          actionPending: false,
          attachments: [
            {
              source: "user" as const,
              text: "every available example",
              wordCount: 3,
              blocks: [
                {
                  nodeId: issue.anchor.nodeId,
                  nodeType: "paragraph" as const,
                  text: "every available example",
                  headingPath: [],
                },
              ],
            },
          ],
          collapsed: false,
          content: "Here is the relevant context.",
          events: [],
          issue,
          loading: false,
          messages: [],
          thread: {
            issueId: issue.id,
            documentId: issue.documentId,
            state: "idle" as const,
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
          unread: false,
          onAction,
          onClose: vi.fn(),
          onCollapse,
          onContentChange: vi.fn(),
          onRemoveAttachment,
          onSend,
        }),
      );
    });

    expect(container.textContent).toContain("3 words");
    const button = (name: string) =>
      [...container.querySelectorAll("button")].find(
        (entry) => entry.textContent?.trim() === name,
      );
    await act(async () => button("Send")?.click());
    await act(async () => button("Resolve")?.click());
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Collapse issue chat"]',
        )
        ?.click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove attachment 1"]',
        )
        ?.click(),
    );

    expect(onSend).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith(issue, "resolve");
    expect(onCollapse).toHaveBeenCalledWith(true);
    expect(onRemoveAttachment).toHaveBeenCalledWith(0);

    await act(async () => root.unmount());
    container.remove();
  });
});
