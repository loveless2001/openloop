import {
  JsonObjectSchema,
  type CriticTrigger,
  type EditorOperation,
  type EditorChangeBatch,
  type IssueRecord,
  type JsonValue,
} from "@openloop/shared";
import { EditorContent, useEditor } from "@tiptap/react";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildChangeBatch, textBlockSnapshots } from "./change-tracker.js";
import {
  COMPLETION_ACCEPTED_SELECTION_META,
  CompletionDecoration,
  completionDecorationKey,
} from "./completion-decoration.js";
import {
  getCriticSelection,
  type EditorCriticSelection,
} from "./critic-selection.js";
import { InlineCompletionController } from "./inline-completion-controller.js";
import { IssueGutter, setIssueGutterState } from "./issue-gutter.js";
import { ensureStableNodeIds, StableNodeId } from "./stable-node-id.js";
import type { PersonalDictionaryEntry } from "../personal-dictionary.js";

interface OpenLoopEditorProps {
  documentId: string;
  baseVersion: number;
  completionDebounceMs: number;
  dictionaryEnabled: boolean;
  dictionaryEntries: PersonalDictionaryEntry[];
  content: Record<string, JsonValue>;
  completionBlocked: boolean;
  activeChatIssueId?: string;
  issues: IssueRecord[];
  selectedIssueId?: string;
  onCompletionStatus: (message?: string, durationMs?: number) => void;
  onCompositionChange: (composing: boolean) => void;
  onCursorBlockChange: (nodeId: string, orderedNodeIds: string[]) => void;
  onCriticTrigger: (trigger: CriticTrigger) => void;
  onCritiqueSelection: (selection: EditorCriticSelection) => void;
  onAddSelectionToChat: (selection: EditorCriticSelection) => void;
  onChange: (
    content: Record<string, JsonValue>,
    plainText: string,
    batch: EditorChangeBatch,
  ) => void;
  onSelectIssue: (issueId?: string) => void;
  onSelectionChange: (selection: EditorCriticSelection | null) => void;
}

export interface OpenLoopEditorHandle {
  applyOperation: (operation: EditorOperation, expectedText: string) => boolean;
  focusIssue: (issue: IssueRecord) => boolean;
  getMarkdown: () => string;
  hasVisibleCompletion: () => boolean;
  parseMarkdown: (markdown: string) => Record<string, JsonValue>;
}

function nodeTypes(document: ProseMirrorNode): Map<string, string> {
  const result = new Map<string, string>();
  document.descendants((node) => {
    if (typeof node.attrs.nodeId === "string") {
      result.set(node.attrs.nodeId, node.type.name);
    }
  });
  return result;
}

export const OpenLoopEditor = forwardRef<
  OpenLoopEditorHandle,
  OpenLoopEditorProps
>(function OpenLoopEditor(
  {
    documentId,
    baseVersion,
    completionDebounceMs,
    dictionaryEnabled,
    dictionaryEntries,
    content,
    completionBlocked,
    activeChatIssueId,
    issues,
    selectedIssueId,
    onCompletionStatus,
    onCompositionChange,
    onCursorBlockChange,
    onCriticTrigger,
    onCritiqueSelection,
    onAddSelectionToChat,
    onChange,
    onSelectIssue,
    onSelectionChange,
  },
  ref,
) {
  const normalized = useMemo(() => ensureStableNodeIds(content), [content]);
  const versionRef = useRef(baseVersion);
  const onChangeRef = useRef(onChange);
  const completionBlockedRef = useRef(completionBlocked);
  const completionDebounceMsRef = useRef(completionDebounceMs);
  const dictionaryRef = useRef({
    enabled: dictionaryEnabled,
    entries: dictionaryEntries,
  });
  const onCompletionStatusRef = useRef(onCompletionStatus);
  const onCompositionChangeRef = useRef(onCompositionChange);
  const onCursorBlockChangeRef = useRef(onCursorBlockChange);
  const onCriticTriggerRef = useRef(onCriticTrigger);
  const onCritiqueSelectionRef = useRef(onCritiqueSelection);
  const onAddSelectionToChatRef = useRef(onAddSelectionToChat);
  const onSelectIssueRef = useRef(onSelectIssue);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const completionControllerRef = useRef<InlineCompletionController | null>(
    null,
  );
  const sequenceRef = useRef(0);
  const editorStackRef = useRef<HTMLDivElement>(null);
  const [activeSelection, setActiveSelection] = useState<{
    selection: EditorCriticSelection;
    left: number;
    top: number;
  } | null>(null);
  versionRef.current = baseVersion;
  onChangeRef.current = onChange;
  completionBlockedRef.current = completionBlocked;
  completionDebounceMsRef.current = completionDebounceMs;
  dictionaryRef.current = {
    enabled: dictionaryEnabled,
    entries: dictionaryEntries,
  };
  onCompletionStatusRef.current = onCompletionStatus;
  onCompositionChangeRef.current = onCompositionChange;
  onCursorBlockChangeRef.current = onCursorBlockChange;
  onCriticTriggerRef.current = onCriticTrigger;
  onCritiqueSelectionRef.current = onCritiqueSelection;
  onAddSelectionToChatRef.current = onAddSelectionToChat;
  onSelectIssueRef.current = onSelectIssue;
  onSelectionChangeRef.current = onSelectionChange;

  useEffect(() => {
    completionControllerRef.current?.handleBlockedChange();
  }, [completionBlocked]);

  useEffect(() => {
    completionControllerRef.current?.handleDictionaryChange();
  }, [dictionaryEnabled, dictionaryEntries]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Markdown,
        StableNodeId,
        CompletionDecoration.configure({
          onAcceptFull: (completion) =>
            completionControllerRef.current?.acceptFull(completion),
          onAcceptWord: (completion, acceptedText, remainingText) =>
            completionControllerRef.current?.acceptWord(
              completion,
              acceptedText,
              remainingText,
            ),
          onDismiss: (completion) =>
            completionControllerRef.current?.dismiss(completion),
        }),
        IssueGutter.configure({
          onSelect: (issueId) => onSelectIssueRef.current(issueId),
        }),
      ],
      content: normalized.content,
      editorProps: {
        attributes: {
          "aria-label": "Document editor",
          class: "openloop-editor",
          spellcheck: "true",
        },
        handleDOMEvents: {
          keydown: (view, event) => {
            if (
              event.key === "Enter" &&
              view.state.selection.empty &&
              view.state.selection.$from.parent.type.name === "paragraph" &&
              view.state.selection.$from.parent.textContent.trim()
            ) {
              onCriticTriggerRef.current("paragraph_end");
            }
            return false;
          },
          compositionstart: () => {
            onCompositionChangeRef.current(true);
            completionControllerRef.current?.handleCompositionStart();
            return false;
          },
          compositionend: () => {
            onCompositionChangeRef.current(false);
            completionControllerRef.current?.handleCompositionEnd();
            return false;
          },
        },
      },
      onCreate: ({ editor: createdEditor }) => {
        completionControllerRef.current = new InlineCompletionController({
          editor: createdEditor,
          documentId,
          getDocumentVersion: () => versionRef.current,
          hasFocus: () => createdEditor.isFocused,
          isBlocked: () => completionBlockedRef.current,
          getDebounceMs: () => completionDebounceMsRef.current,
          getDictionary: () => dictionaryRef.current,
          onStatus: (message, durationMs) =>
            onCompletionStatusRef.current(message, durationMs),
        });
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
      onTransaction: ({ transaction }) => {
        completionControllerRef.current?.handleTransaction(transaction);
      },
      onSelectionUpdate: ({ editor: updatedEditor, transaction }) => {
        const cursorNodeId = updatedEditor.state.selection.$from.parent.attrs
          .nodeId as unknown;
        if (typeof cursorNodeId === "string") {
          onCursorBlockChangeRef.current(
            cursorNodeId,
            textBlockSnapshots(updatedEditor.state.doc).map(
              (block) => block.nodeId,
            ),
          );
        }
        const selection = getCriticSelection(
          updatedEditor,
          transaction.getMeta(COMPLETION_ACCEPTED_SELECTION_META)
            ? "completion"
            : "user",
        );
        onSelectionChangeRef.current(selection);
        if (!selection) {
          setActiveSelection(null);
          return;
        }
        const start = updatedEditor.view.coordsAtPos(selection.from);
        const end = updatedEditor.view.coordsAtPos(selection.to);
        const stackBounds = editorStackRef.current?.getBoundingClientRect();
        setActiveSelection({
          selection,
          left: (start.left + end.right) / 2 - (stackBounds?.left ?? 0),
          top: Math.min(start.top, end.top) - (stackBounds?.top ?? 0),
        });
      },
      onFocus: () => completionControllerRef.current?.handleFocus(),
      onBlur: () => completionControllerRef.current?.handleBlur(),
      onDestroy: () => {
        completionControllerRef.current?.destroy();
        completionControllerRef.current = null;
        onSelectionChangeRef.current(null);
      },
      onUpdate: ({ editor: updatedEditor, transaction }) => {
        sequenceRef.current += 1;
        const batch = buildChangeBatch({
          transaction,
          currentDocument: updatedEditor.state.doc,
          documentId,
          baseVersion: versionRef.current,
          clientSequence: sequenceRef.current,
        });
        onChangeRef.current(
          JsonObjectSchema.parse(updatedEditor.getJSON()),
          updatedEditor.getText({ blockSeparator: "\n" }),
          batch,
        );
        const previousTypes = nodeTypes(transaction.before);
        if (
          batch.changedBlocks.some(
            (block) =>
              block.nodeType === "heading" &&
              previousTypes.get(block.nodeId) !== "heading",
          )
        ) {
          onCriticTriggerRef.current("heading_created");
        }
      },
    },
    [documentId],
  );
  useEffect(() => {
    if (!editor) return;
    setIssueGutterState(editor.view, {
      issues,
      ...(selectedIssueId ? { activeIssueId: selectedIssueId } : {}),
    });
  }, [editor, issues, selectedIssueId]);

  useImperativeHandle(
    ref,
    () => ({
      applyOperation(operation, expectedText) {
        if (!editor) return false;
        let position: number | undefined;
        let text = "";
        editor.state.doc.descendants((node, nodePosition) => {
          if (node.attrs.nodeId === operation.nodeId) {
            position = nodePosition + 1;
            text = node.textContent;
            return false;
          }
        });
        if (
          position === undefined ||
          operation.to > text.length ||
          operation.from > operation.to ||
          text.slice(operation.from, operation.to) !== expectedText
        ) {
          return false;
        }
        editor.view.dispatch(
          editor.state.tr.insertText(
            operation.insertText,
            position + operation.from,
            position + operation.to,
          ),
        );
        editor.commands.focus();
        return true;
      },
      focusIssue(issue) {
        if (!editor) return false;
        let target: number | undefined;
        editor.state.doc.descendants((node, position) => {
          if (node.attrs.nodeId === issue.anchor.nodeId) {
            const quoteStart = node.textContent.indexOf(issue.anchor.quote);
            target = position + 1 + Math.max(0, quoteStart);
            return false;
          }
        });
        if (target === undefined) return false;
        editor.view.dispatch(
          editor.state.tr
            .setSelection(TextSelection.near(editor.state.doc.resolve(target)))
            .scrollIntoView(),
        );
        editor.commands.focus();
        return true;
      },
      getMarkdown() {
        return editor?.getMarkdown() ?? "";
      },
      hasVisibleCompletion() {
        return Boolean(
          editor && completionDecorationKey.getState(editor.state),
        );
      },
      parseMarkdown(markdown) {
        if (!editor?.markdown) throw new Error("The editor is not ready.");
        const parsed = JsonObjectSchema.parse(editor.markdown.parse(markdown));
        return ensureStableNodeIds(parsed).content;
      },
    }),
    [editor],
  );

  return (
    <div className="editor-stack" ref={editorStackRef}>
      <div
        aria-label="Markdown formatting"
        className="format-toolbar"
        role="toolbar"
      >
        <button
          aria-label="Undo"
          disabled={!editor?.can().chain().focus().undo().run()}
          onClick={() => editor?.chain().focus().undo().run()}
          title="Undo"
          type="button"
        >
          ↶
        </button>
        <button
          aria-label="Redo"
          disabled={!editor?.can().chain().focus().redo().run()}
          onClick={() => editor?.chain().focus().redo().run()}
          title="Redo"
          type="button"
        >
          ↷
        </button>
        <span className="toolbar-divider" />
        <button
          aria-pressed={editor?.isActive("bold") ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Bold — Markdown **text**"
          type="button"
        >
          <strong>B</strong>
        </button>
        <button
          aria-pressed={editor?.isActive("italic") ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Italic — Markdown *text*"
          type="button"
        >
          <em>I</em>
        </button>
        <button
          aria-pressed={editor?.isActive("code") ?? false}
          onClick={() => editor?.chain().focus().toggleCode().run()}
          title="Inline code — Markdown `code`"
          type="button"
        >
          {"<>"}
        </button>
        <span className="toolbar-divider" />
        <button
          aria-pressed={editor?.isActive("heading", { level: 1 }) ?? false}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 1 }).run()
          }
          title="Heading 1"
          type="button"
        >
          H1
        </button>
        <button
          aria-pressed={editor?.isActive("heading", { level: 2 }) ?? false}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
          title="Heading 2"
          type="button"
        >
          H2
        </button>
        <button
          aria-pressed={editor?.isActive("bulletList") ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="Bullet list"
          type="button"
        >
          • List
        </button>
        <button
          aria-pressed={editor?.isActive("blockquote") ?? false}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          title="Blockquote"
          type="button"
        >
          “ ”
        </button>
        <span className="markdown-indicator">Markdown</span>
      </div>
      <EditorContent editor={editor} />
      {activeSelection ? (
        <div
          aria-label="Selected text actions"
          className="selection-toolbar"
          data-source={activeSelection.selection.source}
          role="toolbar"
          style={{ left: activeSelection.left, top: activeSelection.top }}
        >
          <span className="selection-toolbar-label">
            {activeSelection.selection.source === "completion"
              ? "Accepted suggestion"
              : `${activeSelection.selection.wordCount} ${
                  activeSelection.selection.wordCount === 1 ? "word" : "words"
                }`}
          </span>
          <button
            onClick={() =>
              onCritiqueSelectionRef.current(activeSelection.selection)
            }
            onMouseDown={(event) => event.preventDefault()}
            title="Ask the critic to review only the highlighted text"
            type="button"
          >
            Critique
          </button>
          {activeChatIssueId ? (
            <button
              onClick={() =>
                onAddSelectionToChatRef.current(activeSelection.selection)
              }
              onMouseDown={(event) => event.preventDefault()}
              title="Attach the highlighted text to the current issue chat"
              type="button"
            >
              Add to chat
            </button>
          ) : null}
          <button
            aria-label="Keep text and clear highlight"
            onClick={() => {
              editor?.commands.setTextSelection(activeSelection.selection.to);
              editor?.commands.focus();
            }}
            onMouseDown={(event) => event.preventDefault()}
            title="Keep the text and clear the highlight"
            type="button"
          >
            Keep
          </button>
        </div>
      ) : null}
    </div>
  );
});
