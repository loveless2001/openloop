// @vitest-environment happy-dom

import type { IssueRecord, TextBlockSnapshot } from "@openloop/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isTwoBlocksAway, useIssueLedger } from "./use-issue-ledger.js";

const documentId = "4bd41f6e-a0f5-48a1-b4bb-d31b55f662f4";
const issueId = "0d09aa01-70fa-4507-9dfa-46ae57ce53c4";
const anchorNodeId = "51ec4dfc-ce05-4111-be2e-bcbe632b18ea";
const changedNodeId = "fb12bf9f-d5c5-4b01-81e2-3cf1ef83eeaa";
const timestamp = "2026-08-21T12:00:00.000Z";
const originalFetch = globalThis.fetch;

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function issue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: issueId,
    documentId,
    type: "ambiguity",
    status: "open",
    question: "Are interface compatibility and model quality equivalent?",
    rationale: "Compatibility and quality differ.",
    severity: 4,
    confidence: 0.98,
    interruptWorthiness: 0.95,
    anchor: {
      nodeId: anchorNodeId,
      quote: "model interface quality",
      leftContext: "",
      rightContext: "",
      normalizedFingerprint: "a".repeat(64),
      sourceDocumentVersion: 1,
      detached: false,
    },
    keywords: ["model", "interface", "quality"],
    resurfaceTriggers: ["claim_reused", "manual_review"],
    dedupeKey: "b".repeat(64),
    shownCount: 1,
    silentIgnoreCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function changedBlock(): TextBlockSnapshot {
  return {
    nodeId: changedNodeId,
    nodeType: "paragraph",
    text: "The model interface therefore guarantees equivalent quality.",
    headingPath: [],
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("issue ledger resurfacing", () => {
  it("recognizes cursor movement of at least two text blocks", () => {
    expect(
      isTwoBlocksAway(anchorNodeId, changedNodeId, [
        anchorNodeId,
        crypto.randomUUID(),
        changedNodeId,
      ]),
    ).toBe(true);
    expect(
      isTwoBlocksAway(anchorNodeId, changedNodeId, [
        anchorNodeId,
        changedNodeId,
      ]),
    ).toBe(false);
  });

  it("records silent ignore only after an automatic show", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
    vi.stubGlobal("EventSource", undefined);
    const resurfaced = issue({ shownCount: 2, lastShownAt: timestamp });
    const ignored = issue({
      shownCount: 2,
      silentIgnoreCount: 1,
      lastShownAt: timestamp,
    });
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/v1/documents/${documentId}/issues`)) {
        return Response.json({ issues: [issue()] });
      }
      if (url.endsWith(`/v1/documents/${documentId}/resurface`)) {
        return Response.json({ issue: resurfaced });
      }
      if (url.endsWith(`/v1/issues/${issueId}/events`)) {
        return Response.json({ events: [] });
      }
      if (url.endsWith(`/v1/issues/${issueId}/actions`)) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          action: "silent_ignore",
          documentVersion: 2,
        });
        return Response.json({ issue: ignored });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    globalThis.fetch = fetchImplementation;
    let ledger: ReturnType<typeof useIssueLedger> | undefined;
    const statuses: string[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness() {
      ledger = useIssueLedger({
        documentId,
        documentVersion: 2,
        onStatus: (message) => {
          if (message) statuses.push(message);
        },
      });
      return null;
    }

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await ledger?.resurface("claim_reused", [changedBlock()]);
    });
    expect(ledger?.selectedIssue?.id).toBe(issueId);
    expect(statuses).toContain("Still open — this issue is relevant again.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
      ledger?.noteMeaningfulEdit([changedBlock()]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(ledger?.issues.find((entry) => entry.id === issueId)).toMatchObject({
      silentIgnoreCount: 1,
    });
    expect(
      fetchImplementation.mock.calls.filter(([request]) =>
        String(request).endsWith(`/v1/issues/${issueId}/actions`),
      ),
    ).toHaveLength(1);

    await act(async () => root.unmount());
  });

  it("does not treat manual review as silent ignorance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
    vi.stubGlobal("EventSource", undefined);
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith(`/v1/documents/${documentId}/issues`)) {
        return Response.json({ issues: [issue()] });
      }
      if (url.endsWith(`/v1/documents/${documentId}/resurface`)) {
        return Response.json({ issue: issue({ shownCount: 2 }) });
      }
      if (url.endsWith(`/v1/issues/${issueId}/events`)) {
        return Response.json({ events: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    globalThis.fetch = fetchImplementation;
    let ledger: ReturnType<typeof useIssueLedger> | undefined;
    const container = document.createElement("div");
    const root = createRoot(container);

    function Harness() {
      ledger = useIssueLedger({
        documentId,
        documentVersion: 2,
        onStatus: () => undefined,
      });
      return null;
    }

    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await ledger?.resurface("manual_review");
      await vi.advanceTimersByTimeAsync(30_001);
      ledger?.noteMeaningfulEdit([changedBlock()]);
      await Promise.resolve();
    });
    expect(
      fetchImplementation.mock.calls.some(([request]) =>
        String(request).endsWith(`/v1/issues/${issueId}/actions`),
      ),
    ).toBe(false);

    await act(async () => root.unmount());
  });
});
