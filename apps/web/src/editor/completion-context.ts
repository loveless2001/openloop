import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const COMPLETION_NODE_TYPES = new Set(["paragraph", "heading", "blockquote"]);

export interface CompletionContext {
  absolutePosition: number;
  cursorOffset: number;
  headingPath: string[];
  nodeId: string;
  nodeText: string;
  prefix: string;
  suffix: string;
}

function headingPathAt(
  document: ProseMirrorNode,
  cursorPosition: number,
): string[] {
  let path: string[] = [];
  document.descendants((node, position) => {
    if (position >= cursorPosition) return false;
    if (node.type.name !== "heading") return;
    const level = typeof node.attrs.level === "number" ? node.attrs.level : 1;
    path = [...path.slice(0, level - 1), node.textContent];
  });
  return path;
}

export function getCompletionContext(editor: Editor): CompletionContext | null {
  const { selection, doc } = editor.state;
  if (!selection.empty) return null;
  const parent = selection.$from.parent;
  if (!COMPLETION_NODE_TYPES.has(parent.type.name)) return null;
  if (selection.$from.parentOffset !== parent.content.size) return null;
  if (parent.type.name === "heading" && parent.textContent.trim() === "")
    return null;
  if (typeof parent.attrs.nodeId !== "string") return null;

  const absolutePosition = selection.from;
  return {
    absolutePosition,
    cursorOffset: selection.$from.parentOffset,
    headingPath: headingPathAt(doc, absolutePosition),
    nodeId: parent.attrs.nodeId,
    nodeText: parent.textContent,
    prefix: doc.textBetween(
      Math.max(0, absolutePosition - 1500),
      absolutePosition,
      "\n",
      "\n",
    ),
    suffix: doc.textBetween(
      absolutePosition,
      Math.min(doc.content.size, absolutePosition + 300),
      "\n",
      "\n",
    ),
  };
}

export function countAddedNonWhitespace(before: string, after: string): number {
  let prefixLength = 0;
  while (
    prefixLength < before.length &&
    prefixLength < after.length &&
    before[prefixLength] === after[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength &&
    suffixLength < after.length - prefixLength &&
    before[before.length - 1 - suffixLength] ===
      after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return after
    .slice(prefixLength, after.length - suffixLength)
    .replace(/\s/g, "").length;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
