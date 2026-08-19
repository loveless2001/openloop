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
});
