import type { TextBlockSnapshot } from "@openloop/shared";
import type { Editor } from "@tiptap/core";

import { textBlockSnapshots } from "./change-tracker.js";

export type CriticSelectionSource = "user" | "completion";

export interface EditorCriticSelection {
  blocks: TextBlockSnapshot[];
  from: number;
  source: CriticSelectionSource;
  text: string;
  to: number;
  wordCount: number;
}

export function countWords(value: string): number {
  return (
    value.match(
      /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu,
    )?.length ?? 0
  );
}

export function getCriticSelection(
  editor: Editor,
  source: CriticSelectionSource = "user",
): EditorCriticSelection | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;

  const snapshotById = new Map(
    textBlockSnapshots(editor.state.doc).map((block) => [block.nodeId, block]),
  );
  const canonicalBlocks: Array<{ nodeId: string; text: string }> = [];
  const blocks: TextBlockSnapshot[] = [];
  editor.state.doc.descendants((node, position) => {
    if (
      !["paragraph", "heading", "codeBlock"].includes(node.type.name) ||
      typeof node.attrs.nodeId !== "string"
    ) {
      return;
    }
    canonicalBlocks.push({
      nodeId: node.attrs.nodeId,
      text: node.textBetween(0, node.content.size, "\n", "\n"),
    });
    const contentFrom = position + 1;
    const contentTo = contentFrom + node.content.size;
    const selectedFrom = Math.max(from, contentFrom);
    const selectedTo = Math.min(to, contentTo);
    if (selectedFrom >= selectedTo) return;

    const localFrom = selectedFrom - contentFrom;
    const localTo = selectedTo - contentFrom;
    const text = node.textBetween(localFrom, localTo, "\n", "\n");
    if (!text.trim()) return;
    const snapshot = snapshotById.get(node.attrs.nodeId);
    if (!snapshot) return;
    blocks.push({
      nodeId: snapshot.nodeId,
      nodeType: snapshot.nodeType,
      text,
      headingPath: snapshot.headingPath,
      selectionStart: node.textBetween(0, localFrom, "\n", "\n").length,
      selectionEnd: node.textBetween(0, localTo, "\n", "\n").length,
    });
  });

  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last) return null;
  const firstIndex = canonicalBlocks.findIndex(
    (block) => block.nodeId === first.nodeId,
  );
  const lastIndex = canonicalBlocks.findIndex(
    (block) => block.nodeId === last.nodeId,
  );
  if (firstIndex < 0 || lastIndex < firstIndex) return null;
  const text = canonicalBlocks
    .slice(firstIndex, lastIndex + 1)
    .map((block, index, selectedBlocks) => {
      const start = index === 0 ? (first.selectionStart ?? 0) : 0;
      const end =
        index === selectedBlocks.length - 1
          ? (last.selectionEnd ?? block.text.length)
          : block.text.length;
      return block.text.slice(start, end);
    })
    .join("\n");
  const wordCount = countWords(text);
  if (!blocks.length || wordCount === 0) return null;
  return { blocks, from, source, text, to, wordCount };
}
