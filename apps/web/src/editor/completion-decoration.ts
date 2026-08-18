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

function acceptFull(
  view: EditorView,
  completion: CompletionDecorationState,
  callback: CompletionDecorationOptions["onAcceptFull"],
): void {
  callback(completion);
  view.dispatch(interactionTransaction(view, completion, completion.text, ""));
  view.focus();
}

function dismiss(
  view: EditorView,
  completion: CompletionDecorationState,
  callback: CompletionDecorationOptions["onDismiss"],
): void {
  callback(completion);
  setCompletionDecoration(view, null);
  view.focus();
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
      const options = this.options;
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
                  (view) => {
                    const widget = document.createElement("span");
                    widget.className = "completion-widget";
                    widget.contentEditable = "false";

                    const ghost = document.createElement("span");
                    ghost.className = "completion-ghost";
                    ghost.setAttribute("aria-hidden", "true");
                    ghost.textContent = completion.text;
                    widget.append(ghost);

                    const controls = document.createElement("span");
                    controls.className = "completion-controls";
                    controls.setAttribute("aria-label", "Completion actions");

                    const acceptButton = document.createElement("button");
                    acceptButton.type = "button";
                    acceptButton.className = "completion-action accept";
                    acceptButton.title = "Accept suggestion (Tab)";
                    acceptButton.setAttribute(
                      "aria-label",
                      "Accept suggestion (Tab)",
                    );
                    acceptButton.textContent = "Accept  Tab";
                    acceptButton.addEventListener("mousedown", (event) =>
                      event.preventDefault(),
                    );
                    acceptButton.addEventListener("click", () =>
                      acceptFull(view, completion, options.onAcceptFull),
                    );

                    const rejectButton = document.createElement("button");
                    rejectButton.type = "button";
                    rejectButton.className = "completion-action reject";
                    rejectButton.title = "Reject suggestion (Escape)";
                    rejectButton.setAttribute(
                      "aria-label",
                      "Reject suggestion (Escape)",
                    );
                    rejectButton.textContent = "Reject  Esc";
                    rejectButton.addEventListener("mousedown", (event) =>
                      event.preventDefault(),
                    );
                    rejectButton.addEventListener("click", () =>
                      dismiss(view, completion, options.onDismiss),
                    );

                    controls.append(acceptButton, rejectButton);
                    widget.append(controls);
                    return widget;
                  },
                  {
                    key: `${completion.requestId}:${completion.text}`,
                    side: 1,
                    stopEvent: (event) =>
                      event.target instanceof Element &&
                      Boolean(event.target.closest(".completion-controls")),
                  },
                ),
              ]);
            },
            handleKeyDown: (view, event) => {
              const completion = completionDecorationKey.getState(view.state);
              if (!completion?.text) return false;

              if (event.key === "Tab") {
                event.preventDefault();
                acceptFull(view, completion, options.onAcceptFull);
                return true;
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                const acceptedText = firstWord(completion.text);
                const remainingText = completion.text.slice(
                  acceptedText.length,
                );
                options.onAcceptWord(completion, acceptedText, remainingText);
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
                dismiss(view, completion, options.onDismiss);
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
