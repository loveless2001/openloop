// @vitest-environment happy-dom

import type { EditorChangeBatch } from "@openloop/shared";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_APP_SETTINGS, type AppSettings } from "./app-settings.js";
import type { EditorCriticSelection } from "./editor/critic-selection.js";
import { countWords, useCriticScheduler } from "./use-critic-scheduler.js";

const documentId = "8818261b-5a2b-49da-ab1e-274f51ce251b";
const nodeId = "d852e30b-31f4-4262-9197-1f4e4d9c11b6";
const originalFetch = globalThis.fetch;

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function changeBatch(text: string, previousText = ""): EditorChangeBatch {
  return {
    documentId,
    baseVersion: 0,
    clientSequence: 1,
    changedBlocks: [
      {
        nodeId,
        nodeType: "paragraph",
        text,
        previousText,
        headingPath: [],
      },
    ],
    removedNodeIds: [],
    mergedNodeMap: {},
    reason: "typing",
  };
}

describe("critic scheduler preferences", () => {
  it("counts Unicode words and contractions", () => {
    expect(countWords("One two, don't stop — สวัสดี 42")).toBe(6);
  });

  it("waits for the configured ten-second idle interval", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ jobId: crypto.randomUUID(), status: "queued" }),
    );
    globalThis.fetch = fetchImplementation;
    let queueChange: ((batch: EditorChangeBatch) => void) | undefined;
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness({ settings }: { settings: AppSettings }) {
      const scheduler = useCriticScheduler({
        settings,
        flushDocument: async () => undefined,
        getDocument: () => ({
          id: documentId,
          title: "Draft",
          contentJson: { type: "doc" },
          plainText: "Some changed text",
          version: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getDocumentVersion: () => 0,
        isBlocked: () => false,
        reportStatus: () => undefined,
      });
      useEffect(() => {
        queueChange = scheduler.queueChange;
      }, [scheduler.queueChange]);
      return null;
    }

    await act(async () => {
      root.render(createElement(Harness, { settings: DEFAULT_APP_SETTINGS }));
    });
    await act(async () => queueChange?.(changeBatch("one new word")));
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(fetchImplementation).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      trigger: "idle",
    });

    await act(async () => root.unmount());
  });

  it("submits immediately when the configurable new-word threshold is met", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ jobId: crypto.randomUUID(), status: "queued" }),
    );
    globalThis.fetch = fetchImplementation;
    let queueChange: ((batch: EditorChangeBatch) => void) | undefined;
    const container = document.createElement("div");
    const root = createRoot(container);
    const settings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      criticIdleEnabled: false,
      criticWordThreshold: 50,
    };

    function Harness() {
      const scheduler = useCriticScheduler({
        settings,
        flushDocument: async () => undefined,
        getDocument: () => ({
          id: documentId,
          title: "Draft",
          contentJson: { type: "doc" },
          plainText: "Changed text",
          version: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getDocumentVersion: () => 0,
        isBlocked: () => false,
        reportStatus: () => undefined,
      });
      useEffect(() => {
        queueChange = scheduler.queueChange;
      }, [scheduler.queueChange]);
      return null;
    }

    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      queueChange?.(
        changeBatch(
          Array.from({ length: 50 }, (_, index) => `word${index}`).join(" "),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      trigger: "word_threshold",
    });

    await act(async () => root.unmount());
  });

  it("submits highlighted text as an explicit selection scope without pending edits", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ jobId: crypto.randomUUID(), status: "queued" }),
    );
    globalThis.fetch = fetchImplementation;
    let request:
      | ((trigger: "manual", selection: EditorCriticSelection) => void)
      | undefined;
    const flushDocument = vi.fn(async () => undefined);
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness() {
      const scheduler = useCriticScheduler({
        settings: DEFAULT_APP_SETTINGS,
        flushDocument,
        getDocument: () => ({
          id: documentId,
          title: "Draft",
          contentJson: { type: "doc" },
          plainText: "A focused claim",
          version: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        getDocumentVersion: () => 3,
        isBlocked: () => false,
        reportStatus: () => undefined,
      });
      useEffect(() => {
        request = scheduler.request;
      }, [scheduler.request]);
      return null;
    }

    await act(async () => root.render(createElement(Harness)));
    await act(async () => {
      request?.("manual", {
        blocks: [
          {
            nodeId,
            nodeType: "paragraph",
            text: "focused claim",
            headingPath: [],
            selectionStart: 2,
            selectionEnd: 15,
          },
        ],
        from: 3,
        source: "completion",
        text: "focused claim",
        to: 16,
        wordCount: 2,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(flushDocument).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      documentVersion: 3,
      trigger: "manual",
      scope: { kind: "selection", source: "completion", wordCount: 2 },
      changedBlocks: [{ text: "focused claim" }],
    });

    await act(async () => root.unmount());
  });
});
