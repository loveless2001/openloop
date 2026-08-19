// @vitest-environment happy-dom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CompletionDecoration,
  completionDecorationKey,
  setCompletionDecoration,
} from "./completion-decoration.js";
import {
  countAddedNonWhitespace,
  getCompletionContext,
} from "./completion-context.js";
import { InlineCompletionController } from "./inline-completion-controller.js";
import { StableNodeId } from "./stable-node-id.js";

const nodeId = "d852e30b-31f4-4262-9197-1f4e4d9c11b6";
const documentId = "8818261b-5a2b-49da-ab1e-274f51ce251b";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  let handled = false;
  editor.view.someProp("handleKeyDown", (handler) => {
    handled = Boolean(handler(editor.view, event));
    return handled;
  });
  return handled;
}

function editorWithCompletion(callbacks = {}) {
  return new Editor({
    extensions: [
      StarterKit,
      StableNodeId,
      CompletionDecoration.configure(callbacks),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId },
          content: [{ type: "text", text: "abc" }],
        },
      ],
    },
  });
}

describe("completion decoration", () => {
  it("does not alter document content until Tab accepts the completion", () => {
    const onAcceptFull = vi.fn();
    const editor = editorWithCompletion({ onAcceptFull });
    editor.commands.setTextSelection(4);
    setCompletionDecoration(editor.view, {
      requestId: "c4763dfd-c791-4dfb-998f-fbfdee15704a",
      from: 4,
      text: " ghost text",
    });

    expect(editor.getText()).toBe("abc");
    expect(completionDecorationKey.getState(editor.state)?.text).toBe(
      " ghost text",
    );
    expect(press(editor, "Tab")).toBe(true);
    expect(editor.getText()).toBe("abc ghost text");
    expect(editor.state.selection).toMatchObject({ from: 4, to: 15 });
    expect(completionDecorationKey.getState(editor.state)).toBeNull();
    expect(onAcceptFull).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("accepts one word with ArrowRight and dismisses the remainder with Escape", () => {
    const onAcceptWord = vi.fn();
    const onDismiss = vi.fn();
    const editor = editorWithCompletion({ onAcceptWord, onDismiss });
    editor.commands.setTextSelection(4);
    setCompletionDecoration(editor.view, {
      requestId: "c4763dfd-c791-4dfb-998f-fbfdee15704a",
      from: 4,
      text: " hello world",
    });

    expect(press(editor, "ArrowRight")).toBe(true);
    expect(editor.getText()).toBe("abc hello ");
    expect(completionDecorationKey.getState(editor.state)?.text).toBe("world");
    expect(onAcceptWord).toHaveBeenCalledWith(
      expect.any(Object),
      " hello ",
      "world",
    );

    expect(press(editor, "Escape")).toBe(true);
    expect(editor.getText()).toBe("abc hello ");
    expect(completionDecorationKey.getState(editor.state)).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("invalidates ghost text on ordinary document input", () => {
    const editor = editorWithCompletion();
    editor.commands.setTextSelection(4);
    setCompletionDecoration(editor.view, {
      requestId: "c4763dfd-c791-4dfb-998f-fbfdee15704a",
      from: 4,
      text: " stale",
    });

    editor.commands.insertContent("x");
    expect(completionDecorationKey.getState(editor.state)).toBeNull();
    expect(press(editor, "Tab")).toBe(false);
    expect(editor.getText()).toBe("abcx");
    editor.destroy();
  });

  it("replaces a dictionary shortcut with its expansion", () => {
    const onAcceptFull = vi.fn();
    const editor = editorWithCompletion({ onAcceptFull });
    editor.commands.setTextSelection(4);
    setCompletionDecoration(editor.view, {
      requestId: "dictionary:btw",
      from: 4,
      text: " → by the way",
      source: "dictionary",
      insertText: "by the way",
      replaceFrom: 1,
    });

    expect(press(editor, "Tab")).toBe(true);
    expect(editor.getText()).toBe("by the way");
    expect(editor.state.selection).toMatchObject({ from: 1, to: 11 });
    expect(onAcceptFull).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("renders every streamed delta and exposes clickable actions", () => {
    const onAcceptFull = vi.fn();
    const onDismiss = vi.fn();
    const editor = editorWithCompletion({ onAcceptFull, onDismiss });
    editor.commands.setTextSelection(4);
    const completion = {
      requestId: "c4763dfd-c791-4dfb-998f-fbfdee15704a",
      from: 4,
      text: " first",
    };
    setCompletionDecoration(editor.view, completion);
    setCompletionDecoration(editor.view, {
      ...completion,
      text: " first complete sentence",
    });

    expect(
      editor.view.dom.querySelector(".completion-ghost")?.textContent,
    ).toBe(" first complete sentence");
    expect(
      editor.view.dom.querySelector<HTMLButtonElement>(
        '[aria-label="Accept suggestion (Tab)"]',
      )?.title,
    ).toBe("Accept suggestion (Tab)");
    editor.view.dom
      .querySelector<HTMLButtonElement>(
        '[aria-label="Reject suggestion (Escape)"]',
      )
      ?.click();

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(completionDecorationKey.getState(editor.state)).toBeNull();
    expect(onAcceptFull).not.toHaveBeenCalled();
    editor.destroy();
  });
});

describe("completion eligibility context", () => {
  it("requires a collapsed selection at the end of an eligible block", () => {
    const editor = editorWithCompletion();
    editor.commands.setTextSelection(4);
    expect(getCompletionContext(editor)).toMatchObject({
      nodeId,
      cursorOffset: 3,
      prefix: "abc",
    });

    editor.commands.setTextSelection(2);
    expect(getCompletionContext(editor)).toBeNull();
    editor.destroy();
  });

  it("counts only newly added non-whitespace characters", () => {
    expect(countAddedNonWhitespace("abc", "abc d e")).toBe(2);
    expect(countAddedNonWhitespace("abc", "ab c")).toBe(0);
    expect(countAddedNonWhitespace("abc", "abXYZc")).toBe(3);
  });
});

describe("inline completion vertical slice", () => {
  it("requests, displays, and accepts streamed ghost text", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/completion-events")) {
        return Response.json({ accepted: true }, { status: 202 });
      }
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: delta\ndata: {"text":" precise"}\n\n' +
                'event: done\ndata: {"requestId":"c4763dfd-c791-4dfb-998f-fbfdee15704a"}\n\n',
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    globalThis.fetch = fetchImplementation;

    const editor = new Editor({
      extensions: [
        StarterKit,
        StableNodeId,
        CompletionDecoration.configure({
          onAcceptFull: (completion) => controller.acceptFull(completion),
          onAcceptWord: (completion, accepted, remaining) =>
            controller.acceptWord(completion, accepted, remaining),
          onDismiss: (completion) => controller.dismiss(completion),
        }),
      ],
      content: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { nodeId } }],
      },
    });
    const controller = new InlineCompletionController({
      editor,
      documentId,
      getDocumentVersion: () => 0,
      hasFocus: () => true,
      isBlocked: () => false,
      getDebounceMs: () => 0,
      getDictionary: () => ({ enabled: false, entries: [] }),
      onStatus: () => undefined,
    });
    editor.on("transaction", ({ transaction }) =>
      controller.handleTransaction(transaction),
    );
    controller.handleFocus();
    editor.commands.insertContent("abc");

    await vi.waitFor(() => {
      expect(completionDecorationKey.getState(editor.state)?.text).toBe(
        " precise",
      );
    });
    expect(editor.getText()).toBe("abc");
    expect(press(editor, "Tab")).toBe(true);
    expect(editor.getText()).toBe("abc precise");
    expect(
      fetchImplementation.mock.calls.some(([input]) =>
        String(input).endsWith("/v1/completions/stream"),
      ),
    ).toBe(true);
    const interactionEvents = fetchImplementation.mock.calls
      .filter(([input]) => String(input).endsWith("/completion-events"))
      .map(([, init]) => JSON.parse(String(init?.body)).event);
    expect(interactionEvents).toEqual([
      "completion_requested",
      "completion_shown",
      "completion_accepted_full",
    ]);

    controller.destroy();
    editor.destroy();
  });

  it("shows a dictionary result immediately and falls through to Qwen after rejection", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/completion-events")) {
        return Response.json({ accepted: true }, { status: 202 });
      }
      const stream = new ReadableStream({
        start(streamController) {
          streamController.enqueue(
            new TextEncoder().encode(
              'event: delta\ndata: {"text":" alternative"}\n\n' +
                'event: done\ndata: {"requestId":"c4763dfd-c791-4dfb-998f-fbfdee15704a"}\n\n',
            ),
          );
          streamController.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    globalThis.fetch = fetchImplementation;

    const editor = new Editor({
      extensions: [
        StarterKit,
        StableNodeId,
        CompletionDecoration.configure({
          onAcceptFull: (completion) => controller.acceptFull(completion),
          onAcceptWord: (completion, accepted, remaining) =>
            controller.acceptWord(completion, accepted, remaining),
          onDismiss: (completion) => controller.dismiss(completion),
        }),
      ],
      content: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { nodeId } }],
      },
    });
    const controller = new InlineCompletionController({
      editor,
      documentId,
      getDocumentVersion: () => 0,
      hasFocus: () => true,
      isBlocked: () => false,
      getDebounceMs: () => 0,
      getDictionary: () => ({
        enabled: true,
        entries: [{ trigger: "OpenTelemetry", replacement: "OpenTelemetry" }],
      }),
      onStatus: () => undefined,
    });
    editor.on("transaction", ({ transaction }) =>
      controller.handleTransaction(transaction),
    );
    editor.commands.insertContent("OpenT");

    expect(completionDecorationKey.getState(editor.state)).toMatchObject({
      source: "dictionary",
      text: "elemetry",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();

    expect(press(editor, "Escape")).toBe(true);
    await vi.waitFor(() => {
      expect(completionDecorationKey.getState(editor.state)).toMatchObject({
        source: "model",
        text: " alternative",
      });
    });
    expect(
      fetchImplementation.mock.calls.some(([input]) =>
        String(input).endsWith("/v1/completions/stream"),
      ),
    ).toBe(true);

    controller.destroy();
    editor.destroy();
  });
});
