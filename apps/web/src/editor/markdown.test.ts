// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { ensureStableNodeIds, StableNodeId } from "./stable-node-id.js";

describe("Markdown editor bridge", () => {
  it("round-trips Markdown and restores internal stable block IDs", () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown, StableNodeId],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    if (!editor.markdown) throw new Error("Markdown extension did not load.");

    const parsed = editor.markdown.parse(
      "# Heading\n\nA **bold** paragraph.\n\n> A quote",
    );
    const normalized = ensureStableNodeIds(parsed);
    editor.commands.setContent(normalized.content);

    expect(editor.getMarkdown()).toContain("# Heading");
    expect(editor.getMarkdown()).toContain("**bold**");
    expect(editor.getMarkdown()).toContain("> A quote");
    expect(
      normalized.content.content?.every(
        (node) => typeof node.attrs?.nodeId === "string",
      ),
    ).toBe(true);
    editor.destroy();
  });
});
