import type { CompletionInteractionRequest } from "@openloop/shared";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import {
  CompletionStreamError,
  logCompletionInteraction,
  streamCompletion,
} from "../completion-api.js";
import {
  COMPLETION_INTERACTION_META,
  completionDecorationKey,
  setCompletionDecoration,
  type CompletionDecorationState,
} from "./completion-decoration.js";
import {
  countAddedNonWhitespace,
  getCompletionContext,
  sha256,
  type CompletionContext,
} from "./completion-context.js";
import {
  findPersonalDictionarySuggestion,
  type PersonalDictionaryEntry,
} from "../personal-dictionary.js";

interface ActiveCompletion {
  requestId: string;
  documentVersion: number;
  nodeId: string;
  cursorOffset: number;
  prefix: string;
  prefixHash: string;
  text: string;
  controller: AbortController;
  shown: boolean;
}

interface InlineCompletionControllerOptions {
  editor: Editor;
  documentId: string;
  getDocumentVersion: () => number;
  hasFocus: () => boolean;
  isBlocked: () => boolean;
  getDebounceMs: () => number;
  getDictionary: () => {
    enabled: boolean;
    entries: PersonalDictionaryEntry[];
  };
  onStatus: (message?: string, durationMs?: number) => void;
}

export class InlineCompletionController {
  private active: ActiveCompletion | null = null;
  private addedCharacters = 0;
  private composing = false;
  private destroyed = false;
  private dictionarySuppression: string | null = null;
  private preparing = false;
  private timer: number | null = null;

  constructor(private readonly options: InlineCompletionControllerOptions) {}

  handleTransaction(transaction: Transaction): void {
    if (transaction.getMeta(COMPLETION_INTERACTION_META)) {
      this.refreshContextAfterWordAcceptance();
      return;
    }

    const visibleCompletion = completionDecorationKey.getState(
      this.options.editor.state,
    );
    if (visibleCompletion?.source === "dictionary") {
      const current = getCompletionContext(this.options.editor);
      const contextChanged =
        !current || current.absolutePosition !== visibleCompletion.from;
      if (transaction.docChanged || contextChanged) {
        if (transaction.docChanged) this.dictionarySuppression = null;
        setCompletionDecoration(this.options.editor.view, null);
      }
    }

    if (this.active) {
      const current = getCompletionContext(this.options.editor);
      const contextChanged =
        !current ||
        current.nodeId !== this.active.nodeId ||
        current.cursorOffset !== this.active.cursorOffset ||
        current.prefix !== this.active.prefix;
      if (transaction.docChanged) {
        this.invalidate(this.active.shown ? "dismissed" : "stale");
      } else if (contextChanged) {
        this.invalidate("stale");
      }
    }

    if (transaction.docChanged) {
      this.addedCharacters += countAddedNonWhitespace(
        transaction.before.textContent,
        this.options.editor.state.doc.textContent,
      );
    }
    this.schedule();
  }

  handleFocus(): void {
    this.schedule();
  }

  handleBlur(): void {
    this.cancelTimer();
    if (this.active) this.invalidate(this.active.shown ? "dismissed" : "stale");
    if (
      completionDecorationKey.getState(this.options.editor.state)?.source ===
      "dictionary"
    ) {
      setCompletionDecoration(this.options.editor.view, null);
    }
  }

  handleCompositionStart(): void {
    this.composing = true;
    this.cancelTimer();
    if (this.active) this.invalidate(this.active.shown ? "dismissed" : "stale");
    if (
      completionDecorationKey.getState(this.options.editor.state)?.source ===
      "dictionary"
    ) {
      setCompletionDecoration(this.options.editor.view, null);
    }
  }

  handleCompositionEnd(): void {
    this.composing = false;
    this.schedule();
  }

  handleBlockedChange(): void {
    if (this.options.isBlocked() && this.active) {
      this.invalidate(this.active.shown ? "dismissed" : "stale");
    }
    if (
      this.options.isBlocked() &&
      completionDecorationKey.getState(this.options.editor.state)?.source ===
        "dictionary"
    ) {
      setCompletionDecoration(this.options.editor.view, null);
    }
  }

  handleDictionaryChange(): void {
    this.dictionarySuppression = null;
    if (
      completionDecorationKey.getState(this.options.editor.state)?.source ===
      "dictionary"
    ) {
      setCompletionDecoration(this.options.editor.view, null);
    }
    this.schedule();
  }

  acceptFull(completion: CompletionDecorationState): void {
    if (completion.source === "dictionary") {
      this.dictionarySuppression = null;
      this.addedCharacters = 0;
      this.options.onStatus();
      return;
    }
    const active = this.active;
    if (!active || active.requestId !== completion.requestId) return;
    active.controller.abort();
    this.record(active, "completion_accepted_full", completion.text.length);
    this.active = null;
    this.addedCharacters = 0;
    this.options.onStatus();
  }

  acceptWord(
    completion: CompletionDecorationState,
    acceptedText: string,
    remainingText: string,
  ): void {
    const active = this.active;
    if (!active || active.requestId !== completion.requestId) return;
    active.controller.abort();
    this.record(active, "completion_accepted_word", acceptedText.length);
    active.text = remainingText;
    this.addedCharacters = 0;
    if (!remainingText) this.active = null;
    this.options.onStatus();
  }

  dismiss(completion: CompletionDecorationState): void {
    if (completion.source === "dictionary") {
      this.dictionarySuppression = completion.requestId;
      queueMicrotask(() => this.schedule());
      return;
    }
    if (!this.active || this.active.requestId !== completion.requestId) return;
    this.invalidate("rejected");
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelTimer();
    this.active?.controller.abort();
    this.active = null;
  }

  private schedule(): void {
    this.cancelTimer();
    if (
      this.destroyed ||
      this.active ||
      this.preparing ||
      this.composing ||
      this.options.isBlocked() ||
      !this.options.hasFocus()
    ) {
      return;
    }

    const context = getCompletionContext(this.options.editor);
    if (!context) return;
    const visibleCompletion = completionDecorationKey.getState(
      this.options.editor.state,
    );
    if (visibleCompletion?.source === "dictionary") return;
    const dictionary = this.options.getDictionary();
    if (dictionary.enabled) {
      const suggestion = findPersonalDictionarySuggestion(
        context.prefix,
        dictionary.entries,
      );
      if (suggestion) {
        const requestId = `dictionary:${context.nodeId}:${context.cursorOffset}:${suggestion.key}`;
        if (requestId !== this.dictionarySuppression) {
          setCompletionDecoration(this.options.editor.view, {
            requestId,
            from: this.options.editor.state.selection.from,
            text: suggestion.displayText,
            source: "dictionary",
            insertText: suggestion.insertText,
            replaceFrom:
              this.options.editor.state.selection.from -
              suggestion.replaceCharacters,
          });
          return;
        }
      }
    }
    if (this.addedCharacters < 3) return;

    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.request();
    }, this.options.getDebounceMs());
  }

  private async request(): Promise<void> {
    if (
      this.active ||
      this.preparing ||
      this.composing ||
      this.options.isBlocked() ||
      !this.options.hasFocus()
    ) {
      return;
    }
    const context = getCompletionContext(this.options.editor);
    if (!context || this.addedCharacters < 3) return;

    this.preparing = true;
    const prefixHash = await sha256(context.prefix);
    if (!this.matchesContext(context)) {
      this.preparing = false;
      this.schedule();
      return;
    }

    const active: ActiveCompletion = {
      requestId: crypto.randomUUID(),
      documentVersion: this.options.getDocumentVersion(),
      nodeId: context.nodeId,
      cursorOffset: context.cursorOffset,
      prefix: context.prefix,
      prefixHash,
      text: "",
      controller: new AbortController(),
      shown: false,
    };
    this.active = active;
    this.preparing = false;
    this.addedCharacters = 0;
    this.record(active, "completion_requested");
    this.options.onStatus("Completing…");

    try {
      await streamCompletion(
        {
          requestId: active.requestId,
          documentId: this.options.documentId,
          documentVersion: active.documentVersion,
          nodeId: active.nodeId,
          cursorOffset: active.cursorOffset,
          prefix: context.prefix,
          suffix: context.suffix,
          headingPath: context.headingPath,
          prefixHash,
        },
        active.controller.signal,
        {
          onDelta: async (text) => {
            if (this.active !== active) return;
            if (!(await this.isCurrent(active))) {
              this.invalidate("stale");
              return;
            }
            active.text += text;
            if (!active.text) return;
            setCompletionDecoration(this.options.editor.view, {
              requestId: active.requestId,
              from: this.options.editor.state.selection.from,
              text: active.text,
              source: "model",
            });
            if (!active.shown) {
              active.shown = true;
              this.record(active, "completion_shown");
            }
            this.options.onStatus();
          },
          onDone: () => {
            if (this.active === active && !active.shown) this.active = null;
            this.options.onStatus();
          },
        },
      );
    } catch (error) {
      if (active.controller.signal.aborted || this.active !== active) return;
      this.active = null;
      setCompletionDecoration(this.options.editor.view, null);
      this.record(active, "completion_error");
      this.options.onStatus(
        error instanceof CompletionStreamError
          ? `Completion unavailable (${error.code})`
          : "Completion unavailable",
        2_500,
      );
    }
  }

  private async isCurrent(active: ActiveCompletion): Promise<boolean> {
    const context = getCompletionContext(this.options.editor);
    if (!context) return false;
    return (
      context.nodeId === active.nodeId &&
      context.cursorOffset === active.cursorOffset &&
      (await sha256(context.prefix)) === active.prefixHash
    );
  }

  private matchesContext(context: CompletionContext): boolean {
    const current = getCompletionContext(this.options.editor);
    return Boolean(
      !this.destroyed &&
      !this.composing &&
      !this.options.isBlocked() &&
      this.options.hasFocus() &&
      current &&
      current.nodeId === context.nodeId &&
      current.cursorOffset === context.cursorOffset &&
      current.prefix === context.prefix,
    );
  }

  private invalidate(reason: "dismissed" | "rejected" | "stale"): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.controller.abort();
    if (completionDecorationKey.getState(this.options.editor.state)) {
      setCompletionDecoration(this.options.editor.view, null);
    }
    this.record(
      active,
      {
        dismissed: "completion_dismissed",
        rejected: "completion_rejected",
        stale: "completion_stale",
      }[reason] as CompletionInteractionRequest["event"],
    );
    this.options.onStatus();
  }

  private refreshContextAfterWordAcceptance(): void {
    const active = this.active;
    if (!active) return;
    const context = getCompletionContext(this.options.editor);
    if (!context) {
      this.invalidate("stale");
      return;
    }
    active.nodeId = context.nodeId;
    active.cursorOffset = context.cursorOffset;
    active.prefix = context.prefix;
    void sha256(context.prefix).then((hash) => {
      if (this.active === active) active.prefixHash = hash;
    });
  }

  private record(
    active: ActiveCompletion,
    event: CompletionInteractionRequest["event"],
    acceptedCharacters?: number,
  ): void {
    logCompletionInteraction({
      requestId: active.requestId,
      documentId: this.options.documentId,
      documentVersion: active.documentVersion,
      nodeId: active.nodeId,
      event,
      ...(acceptedCharacters === undefined ? {} : { acceptedCharacters }),
    });
  }

  private cancelTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
