// @vitest-environment happy-dom

import type { IssueRecord } from "@openloop/shared";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";

import { IssueGutter, setIssueGutterState } from "./issue-gutter.js";
import { StableNodeId } from "./stable-node-id.js";

const nodeId = "4e43a1a1-6624-4efd-8cd1-a1c041107a9e";
const issue: IssueRecord = {
  id: "29c4b397-cd2e-4dfc-9a9c-45d1252793e7",
  documentId: "bb3c23bf-5dc4-4305-b356-60c36230b456",
  type: "ambiguity",
  status: "open",
  question: "Do you mean every model has equivalent quality?",
  rationale: "API compatibility and quality are different claims.",
  severity: 4,
  confidence: 0.98,
  interruptWorthiness: 0.95,
  anchor: {
    nodeId,
    quote: "any model will work equally well",
    quoteStart: 4,
    quoteEnd: 36,
    leftContext: "The ",
    rightContext: ".",
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

function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent("keydown", { key, cancelable: true });
  let handled = false;
  editor.view.someProp("handleKeyDown", (handler) => {
    handled = Boolean(handler(editor.view, event));
    return handled;
  });
  return handled;
}

describe("issue gutter", () => {
  it("renders a focusable marker and highlights without changing content", () => {
    const onSelect = vi.fn();
    const editor = new Editor({
      extensions: [
        StarterKit,
        StableNodeId,
        IssueGutter.configure({ onSelect }),
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId },
            content: [
              {
                type: "text",
                text: "The any model will work equally well.",
              },
            ],
          },
        ],
      },
    });
    const before = editor.getJSON();
    setIssueGutterState(editor.view, {
      issues: [issue],
      activeIssueId: issue.id,
    });

    const marker = editor.view.dom.querySelector<HTMLButtonElement>(
      ".issue-gutter-marker",
    );
    expect(marker?.tagName).toBe("BUTTON");
    marker?.click();
    expect(onSelect).toHaveBeenCalledWith(issue.id);
    expect(
      editor.view.dom.querySelector(".issue-anchor-highlight"),
    ).not.toBeNull();
    expect(editor.getJSON()).toEqual(before);
    expect(press(editor, "Escape")).toBe(true);
    expect(onSelect).toHaveBeenLastCalledWith();
    editor.destroy();
  });
});
