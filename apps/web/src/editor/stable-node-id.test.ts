// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { ensureStableNodeIds, StableNodeId } from "./stable-node-id.js";

describe("stable node IDs", () => {
  it("assigns missing IDs and regenerates pasted duplicates", () => {
    const kept = "2e2fa838-4488-4e90-980a-f8fb684fddc0";
    const ids = [
      "58c8207d-8b18-4693-bd88-2b39eeb433f7",
      "3da03d61-39f6-48ad-8398-740c0f52743b",
    ];
    const result = ensureStableNodeIds(
      {
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "heading", attrs: { level: 2, nodeId: kept } },
          { type: "paragraph", attrs: { nodeId: kept } },
        ],
      },
      () => ids.shift() ?? "unexpected",
    );

    expect(result.changed).toBe(true);
    expect(result.content.content?.map((node) => node.attrs?.nodeId)).toEqual([
      "58c8207d-8b18-4693-bd88-2b39eeb433f7",
      kept,
      "3da03d61-39f6-48ad-8398-740c0f52743b",
    ]);
  });

  it("preserves the left ID on text edits and gives a split block a new ID", () => {
    const editor = new Editor({
      extensions: [StarterKit, StableNodeId],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: "26eb0ae2-a01a-4cd5-9737-0fbf7df94c64" },
            content: [{ type: "text", text: "abcdef" }],
          },
        ],
      },
    });

    editor.chain().setTextSelection(7).insertContent("!").run();
    expect(editor.getJSON().content?.[0]?.attrs?.nodeId).toBe(
      "26eb0ae2-a01a-4cd5-9737-0fbf7df94c64",
    );

    editor.chain().setTextSelection(4).splitBlock().run();
    const blocks = editor.getJSON().content ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.attrs?.nodeId).toBe(
      "26eb0ae2-a01a-4cd5-9737-0fbf7df94c64",
    );
    expect(blocks[1]?.attrs?.nodeId).toEqual(expect.any(String));
    expect(blocks[1]?.attrs?.nodeId).not.toBe(blocks[0]?.attrs?.nodeId);

    editor.chain().setTextSelection(6).joinBackward().run();
    const merged = editor.getJSON().content ?? [];
    expect(merged).toHaveLength(1);
    expect(merged[0]?.attrs?.nodeId).toBe(
      "26eb0ae2-a01a-4cd5-9737-0fbf7df94c64",
    );

    editor.destroy();
  });
});
