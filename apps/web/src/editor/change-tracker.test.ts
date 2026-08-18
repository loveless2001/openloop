// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { buildChangeBatch, mergeChangeBatches } from "./change-tracker.js";
import { StableNodeId } from "./stable-node-id.js";

const documentId = "4ebad55b-65af-49ec-b121-2526b9e4d465";

describe("changed-node accumulator", () => {
  it("keeps the newest snapshot and preserves removals across saves", () => {
    const merged = mergeChangeBatches(
      {
        documentId,
        baseVersion: 3,
        clientSequence: 1,
        changedBlocks: [
          {
            nodeId: "d8b40629-7374-499e-95bd-dd9742a61c1d",
            nodeType: "paragraph",
            text: "first",
            headingPath: [],
          },
        ],
        removedNodeIds: ["ced85250-f39f-48a6-bd23-9c15f3a17785"],
        mergedNodeMap: {},
        reason: "typing",
      },
      {
        documentId,
        baseVersion: 3,
        clientSequence: 2,
        changedBlocks: [
          {
            nodeId: "d8b40629-7374-499e-95bd-dd9742a61c1d",
            nodeType: "paragraph",
            text: "latest",
            headingPath: [],
          },
        ],
        removedNodeIds: [],
        mergedNodeMap: {},
        reason: "typing",
      },
    );

    expect(merged.baseVersion).toBe(3);
    expect(merged.clientSequence).toBe(2);
    expect(merged.changedBlocks[0]?.text).toBe("latest");
    expect(merged.removedNodeIds).toEqual([
      "ced85250-f39f-48a6-bd23-9c15f3a17785",
    ]);
  });

  it("starts a new accumulation when the active document changes", () => {
    const newer = {
      documentId: "9a69bec1-c348-454c-a828-4531541606ea",
      baseVersion: 0,
      clientSequence: 1,
      changedBlocks: [],
      removedNodeIds: [],
      mergedNodeMap: {},
      reason: "load" as const,
    };
    const merged = mergeChangeBatches(
      {
        ...newer,
        documentId,
        changedBlocks: [
          {
            nodeId: "d8b40629-7374-499e-95bd-dd9742a61c1d",
            nodeType: "paragraph",
            text: "Old document",
            headingPath: [],
          },
        ],
      },
      newer,
    );

    expect(merged).toEqual(newer);
  });

  it("emits the edited block without sending the full document", () => {
    const editor = new Editor({
      extensions: [StarterKit, StableNodeId],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: "d8b40629-7374-499e-95bd-dd9742a61c1d" },
            content: [{ type: "text", text: "first" }],
          },
          {
            type: "paragraph",
            attrs: { nodeId: "ced85250-f39f-48a6-bd23-9c15f3a17785" },
            content: [{ type: "text", text: "unchanged" }],
          },
        ],
      },
    });
    let captured:
      Parameters<typeof buildChangeBatch>[0]["transaction"] | undefined;
    editor.on("transaction", ({ transaction }) => {
      captured = transaction;
    });

    editor.chain().setTextSelection(6).insertContent("!").run();
    expect(captured).toBeDefined();
    const batch = buildChangeBatch({
      transaction: captured!,
      currentDocument: editor.state.doc,
      documentId,
      baseVersion: 4,
      clientSequence: 8,
    });

    expect(batch.changedBlocks).toHaveLength(1);
    expect(batch.changedBlocks[0]).toMatchObject({
      nodeId: "d8b40629-7374-499e-95bd-dd9742a61c1d",
      previousText: "first",
      text: "first!",
    });
    editor.destroy();
  });

  it("removes an ID from removals when undo reintroduces its block", () => {
    const nodeId = "ced85250-f39f-48a6-bd23-9c15f3a17785";
    const merged = mergeChangeBatches(
      {
        documentId,
        baseVersion: 2,
        clientSequence: 1,
        changedBlocks: [],
        removedNodeIds: [nodeId],
        mergedNodeMap: { [nodeId]: "d8b40629-7374-499e-95bd-dd9742a61c1d" },
        reason: "merge",
      },
      {
        documentId,
        baseVersion: 2,
        clientSequence: 2,
        changedBlocks: [
          {
            nodeId,
            nodeType: "paragraph",
            text: "restored",
            headingPath: [],
          },
        ],
        removedNodeIds: [],
        mergedNodeMap: {},
        reason: "typing",
      },
    );

    expect(merged.removedNodeIds).toEqual([]);
    expect(merged.mergedNodeMap).toEqual({});
  });
});
