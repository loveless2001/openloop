import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export interface CompletionDecorationState {
  requestId: string;
  from: number;
  text: string;
}

export const completionDecorationKey =
  new PluginKey<CompletionDecorationState | null>("completionDecoration");

export const COMPLETION_INTERACTION_META = "openloop.completionInteraction";

interface CompletionDecorationOptions {
  onAcceptFull: (completion: CompletionDecorationState) => void;
  onAcceptWord: (
    completion: CompletionDecorationState,
    acceptedText: string,
    remainingText: string,
  ) => void;
  onDismiss: (completion: CompletionDecorationState) => void;
}

function firstWord(text: string): string {
  return /^\s*\S+\s*/.exec(text)?.[0] ?? text;
}

export function setCompletionDecoration(
  view: EditorView,
  completion: CompletionDecorationState | null,
): void {
  view.dispatch(view.state.tr.setMeta(completionDecorationKey, completion));
}

function interactionTransaction(
  view: EditorView,
  completion: CompletionDecorationState,
  acceptedText: string,
  remainingText: string,
): Transaction {
  const nextPosition = completion.from + acceptedText.length;
  return view.state.tr
    .insertText(acceptedText, completion.from)
    .setMeta(COMPLETION_INTERACTION_META, true)
    .setMeta(
      completionDecorationKey,
      remainingText
        ? { ...completion, from: nextPosition, text: remainingText }
        : null,
    );
}

export const CompletionDecoration =
  Extension.create<CompletionDecorationOptions>({
    name: "completionDecoration",

    addOptions() {
      return {
        onAcceptFull: () => undefined,
        onAcceptWord: () => undefined,
        onDismiss: () => undefined,
      };
    },

    addProseMirrorPlugins() {
      return [
        new Plugin<CompletionDecorationState | null>({
          key: completionDecorationKey,
          state: {
            init: () => null,
            apply(transaction, current) {
              const metadata = transaction.getMeta(completionDecorationKey) as
                CompletionDecorationState | null | undefined;
              if (metadata !== undefined) return metadata;
              if (transaction.docChanged) return null;
              return current;
            },
          },
          props: {
            decorations(state) {
              const completion = completionDecorationKey.getState(state);
              if (!completion?.text) return DecorationSet.empty;
              return DecorationSet.create(state.doc, [
                Decoration.widget(
                  completion.from,
                  () => {
                    const element = document.createElement("span");
                    element.className = "completion-ghost";
                    element.setAttribute("aria-hidden", "true");
                    element.textContent = completion.text;
                    return element;
                  },
                  { key: completion.requestId, side: 1 },
                ),
              ]);
            },
            handleKeyDown: (view, event) => {
              const completion = completionDecorationKey.getState(view.state);
              if (!completion?.text) return false;

              if (event.key === "Tab") {
                event.preventDefault();
                this.options.onAcceptFull(completion);
                view.dispatch(
                  interactionTransaction(view, completion, completion.text, ""),
                );
                return true;
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                const acceptedText = firstWord(completion.text);
                const remainingText = completion.text.slice(
                  acceptedText.length,
                );
                this.options.onAcceptWord(
                  completion,
                  acceptedText,
                  remainingText,
                );
                view.dispatch(
                  interactionTransaction(
                    view,
                    completion,
                    acceptedText,
                    remainingText,
                  ),
                );
                return true;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                this.options.onDismiss(completion);
                setCompletionDecoration(view, null);
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
