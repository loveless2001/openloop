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
  const blocks: TextBlockSnapshot[] = [];
  editor.state.doc.descendants((node, position) => {
    if (
      !["paragraph", "heading", "blockquote"].includes(node.type.name) ||
      typeof node.attrs.nodeId !== "string"
    ) {
      return;
    }
    const contentFrom = position + 1;
    const contentTo = contentFrom + node.content.size;
    const selectedFrom = Math.max(from, contentFrom);
    const selectedTo = Math.min(to, contentTo);
    if (selectedFrom >= selectedTo) return;

    const localFrom = selectedFrom - contentFrom;
    const localTo = selectedTo - contentFrom;
    const text = node.textBetween(localFrom, localTo, " ");
    if (!text.trim()) return;
    const snapshot = snapshotById.get(node.attrs.nodeId);
    if (!snapshot) return;
    blocks.push({
      nodeId: snapshot.nodeId,
      nodeType: snapshot.nodeType,
      text,
      headingPath: snapshot.headingPath,
      selectionStart: node.textBetween(0, localFrom, " ").length,
      selectionEnd: node.textBetween(0, localTo, " ").length,
    });
  });

  const text = blocks.map((block) => block.text).join("\n");
  const wordCount = countWords(text);
  if (!blocks.length || wordCount === 0) return null;
  return { blocks, from, source, text, to, wordCount };
}
