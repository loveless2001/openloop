import {
  JsonObjectSchema,
  type EditorChangeBatch,
  type JsonValue,
} from "@openloop/shared";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useMemo, useRef } from "react";

import { buildChangeBatch } from "./change-tracker.js";
import { ensureStableNodeIds, StableNodeId } from "./stable-node-id.js";

interface OpenLoopEditorProps {
  documentId: string;
  baseVersion: number;
  content: Record<string, JsonValue>;
  onChange: (
    content: Record<string, JsonValue>,
    plainText: string,
    batch: EditorChangeBatch,
  ) => void;
}

export function OpenLoopEditor({
  documentId,
  baseVersion,
  content,
  onChange,
}: OpenLoopEditorProps) {
  const normalized = useMemo(() => ensureStableNodeIds(content), [content]);
  const versionRef = useRef(baseVersion);
  const onChangeRef = useRef(onChange);
  const sequenceRef = useRef(0);
  versionRef.current = baseVersion;
  onChangeRef.current = onChange;

  const editor = useEditor(
    {
      extensions: [StarterKit, StableNodeId],
      content: normalized.content,
      editorProps: {
        attributes: {
          "aria-label": "Document editor",
          class: "openloop-editor",
          spellcheck: "true",
        },
      },
      onCreate: ({ editor: createdEditor }) => {
        if (!normalized.changed) return;
        sequenceRef.current += 1;
        const transaction = createdEditor.state.tr;
        onChangeRef.current(
          JsonObjectSchema.parse(createdEditor.getJSON()),
          createdEditor.getText({ blockSeparator: "\n" }),
          buildChangeBatch({
            transaction,
            currentDocument: createdEditor.state.doc,
            documentId,
            baseVersion: versionRef.current,
            clientSequence: sequenceRef.current,
            reason: "load",
          }),
        );
      },
      onUpdate: ({ editor: updatedEditor, transaction }) => {
        sequenceRef.current += 1;
        onChangeRef.current(
          JsonObjectSchema.parse(updatedEditor.getJSON()),
          updatedEditor.getText({ blockSeparator: "\n" }),
          buildChangeBatch({
            transaction,
            currentDocument: updatedEditor.state.doc,
            documentId,
            baseVersion: versionRef.current,
            clientSequence: sequenceRef.current,
          }),
        );
      },
    },
    [documentId],
  );

  return <EditorContent editor={editor} />;
}
