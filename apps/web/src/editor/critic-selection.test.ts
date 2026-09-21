// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { getCriticSelection } from "./critic-selection.js";
import { StableNodeId } from "./stable-node-id.js";

describe("critic selection", () => {
  it("builds exact, node-anchored snapshots from highlighted text", () => {
    const nodeId = "d852e30b-31f4-4262-9197-1f4e4d9c11b6";
    const editor = new Editor({
      extensions: [StarterKit, StableNodeId],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId },
            content: [{ type: "text", text: "alpha beta gamma" }],
          },
        ],
      },
    });

    editor.commands.setTextSelection({ from: 7, to: 11 });
    expect(getCriticSelection(editor, "completion")).toEqual({
      blocks: [
        {
          nodeId,
          nodeType: "paragraph",
          text: "beta",
          headingPath: [],
          selectionStart: 6,
          selectionEnd: 10,
        },
      ],
      from: 7,
      source: "completion",
      text: "beta",
      to: 11,
      wordCount: 1,
    });
    editor.destroy();
  });

  it("ignores collapsed and whitespace-only selections", () => {
    const editor = new Editor({
      extensions: [StarterKit, StableNodeId],
      content: "<p>alpha beta</p>",
    });
    editor.commands.setTextSelection(3);
    expect(getCriticSelection(editor)).toBeNull();
    editor.destroy();
  });

  it("captures nested quote and list text once with UTF-16 offsets", () => {
    const quoteId = "11111111-1111-4111-8111-111111111111";
    const quoteParagraphId = "22222222-2222-4222-8222-222222222222";
    const listParagraphId = "33333333-3333-4333-8333-333333333333";
    const editor = new Editor({
      extensions: [StarterKit, StableNodeId],
      content: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            attrs: { nodeId: quoteId },
            content: [
              {
                type: "paragraph",
                attrs: { nodeId: quoteParagraphId },
                content: [{ type: "text", text: "😀 Việt" }],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { nodeId: listParagraphId },
                    content: [{ type: "text", text: "next" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    editor.commands.setTextSelection({
      from: 2,
      to: editor.state.doc.content.size,
    });
    const selection = getCriticSelection(editor);
    expect(selection?.blocks.map((block) => block.nodeId)).toEqual([
      quoteParagraphId,
      listParagraphId,
    ]);
    expect(selection?.text).toBe("😀 Việt\nnext");
    expect(selection?.blocks[0]).toMatchObject({
      text: "😀 Việt",
      selectionStart: 0,
      selectionEnd: 7,
    });
    editor.destroy();
  });
});
