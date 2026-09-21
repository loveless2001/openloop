// @vitest-environment happy-dom

import type {
  EvaluationIntent,
  EvaluationPreview,
  WritingEvaluationRun,
  WritingRubric,
} from "@openloop/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api.js";
import {
  type EvaluationPreparationIdentity,
  sameEvaluationPreparationIdentity,
  useWritingEvaluation,
} from "./use-writing-evaluation.js";

vi.mock("./api.js", async (importOriginal) => ({
  ...(await importOriginal()),
  cancelWritingEvaluation: vi.fn(),
  createWritingRubric: vi.fn(),
  listWritingEvaluations: vi.fn(),
  loadEvaluatorStatus: vi.fn(),
  loadWritingEvaluation: vi.fn(),
  loadWritingRubrics: vi.fn(),
  previewWritingEvaluation: vi.fn(),
  submitWritingEvaluation: vi.fn(),
  updateWritingRubric: vi.fn(),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const documentOne = "11111111-1111-4111-8111-111111111111";
const documentTwo = "22222222-2222-4222-8222-222222222222";
const rubricId = "33333333-3333-4333-8333-333333333333";
const criterionId = "44444444-4444-4444-8444-444444444444";
const timestamp = "2026-09-21T00:00:00.000Z";

const rubric = {
  id: rubricId,
  revision: 1,
  title: "Selection only",
  purpose: "Explain",
  audience: "Readers",
  criteria: [
    {
      id: criterionId,
      name: "Structure",
      question: "Is the complete draft structured?",
      allowedScopes: ["selection"],
      levels: [
        { label: "Low", description: "Low" },
        { label: "Some", description: "Some" },
        { label: "Strong", description: "Strong" },
      ],
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
} as WritingRubric;

const intent: EvaluationIntent = {
  documentVersion: 1,
  rubricId,
  rubricRevision: 1,
  scope: { kind: "document" },
  languageHint: "en",
};

function preview(documentId = documentOne): EvaluationPreview {
  return {
    snapshot: {
      schemaVersion: "writing-evaluation.v1",
      documentId,
      documentVersion: 1,
      documentContentHash: "b".repeat(64),
      scope: "document",
      targetText: "Draft",
      context: {
        mode: "none",
        before: "",
        after: "",
        beforeClipped: false,
        afterClipped: false,
      },
      languageHint: "en",
      rubricSnapshot: rubric,
      rubricContentHash: "c".repeat(64),
      serializerVersion: "evaluation-text.v1",
      compilerVersion: "jev-writing.v1",
      policyVersion: "jev-display.v1",
      inputHash: "a".repeat(64),
    },
    compiledRequest: {
      model: "mock-writing-fixtures-v1",
      state: {},
      questions: {},
    },
    byteCount: 50,
    byteLimit: 24_000,
    inputHash: "a".repeat(64),
    providerId: "mock",
    requestedModel: "mock-writing-fixtures-v1",
    endpointIdentity: "mock://local",
  };
}

function completedRun(documentId = documentOne): WritingEvaluationRun {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    documentId,
    requestId: "66666666-6666-4666-8666-666666666666",
    documentVersion: 1,
    rubricId,
    rubricRevision: 1,
    inputHash: "a".repeat(64),
    providerId: "mock",
    requestedModel: "mock-writing-fixtures-v1",
    status: "completed",
    providerCalled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    snapshot: preview(documentId).snapshot,
    compiledRequest: preview(documentId).compiledRequest,
    result: {
      criteria: [{ criterionId, status: "incompatible_scope", mixed: false }],
      assessabilityThreshold: 0.7,
      levelThreshold: 0.6,
      providerCalled: false,
    },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function identity(
  overrides: Partial<EvaluationPreparationIdentity> = {},
): EvaluationPreparationIdentity {
  return {
    contextMode: "none",
    documentId: documentOne,
    editorGeneration: 1,
    languageHint: "en",
    rubricId,
    rubricRevision: 1,
    targetKey: "document",
    targetKind: "document",
    ...overrides,
  };
}

type EvaluationHook = ReturnType<typeof useWritingEvaluation>;
let latest: EvaluationHook | undefined;
let root: Root | undefined;

function Harness(props: { documentId: string }) {
  latest = useWritingEvaluation(props.documentId);
  return null;
}

async function render(documentId = documentOne) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Harness, { documentId }));
  });
  await act(async () => Promise.resolve());
  return root;
}

beforeEach(() => {
  vi.mocked(api.loadEvaluatorStatus).mockResolvedValue({
    providerId: "mock",
    requestedModel: "mock-writing-fixtures-v1",
    mode: "mock",
    configured: true,
    label: "Mock — UI test only",
    destination: "local process",
    byteLimit: 24_000,
  });
  vi.mocked(api.loadWritingRubrics).mockResolvedValue([rubric]);
  vi.mocked(api.listWritingEvaluations).mockResolvedValue([]);
  vi.mocked(api.previewWritingEvaluation).mockResolvedValue(preview());
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  latest = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("writing evaluation request identity", () => {
  it("cannot restore a delayed preview after its context is invalidated", async () => {
    await render();
    let release!: (value: EvaluationPreview) => void;
    vi.mocked(api.previewWritingEvaluation).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );

    let preparation!: Promise<unknown>;
    act(() => {
      preparation = latest!.prepare({
        identity: identity({ contextMode: "nearby" }),
        isCurrent: () => true,
        resolveIntent: async () => intent,
        staleMessage: "obsolete",
      });
    });
    await act(async () => Promise.resolve());
    act(() => latest?.invalidatePrepared());
    release(preview());
    await act(async () => preparation);

    expect(latest?.prepared).toBeNull();
  });

  it("rejects rubric or target changes detected after the preview response", async () => {
    await render();
    const capturedIdentity = identity();
    const changes: EvaluationPreparationIdentity[] = [
      { ...capturedIdentity, rubricRevision: 2 },
      { ...capturedIdentity, targetKey: "changed-selection-target" },
    ];
    for (const changedIdentity of changes) {
      let currentIdentity = capturedIdentity;
      let release!: (value: EvaluationPreview) => void;
      vi.mocked(api.previewWritingEvaluation).mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve)),
      );
      let preparation!: Promise<unknown>;
      act(() => {
        preparation = latest!.prepare({
          identity: capturedIdentity,
          isCurrent: () =>
            sameEvaluationPreparationIdentity(
              currentIdentity,
              capturedIdentity,
            ),
          resolveIntent: async () => intent,
          staleMessage: "The target or rubric changed. Prepare it again.",
        });
      });
      await act(async () => Promise.resolve());
      currentIdentity = changedIdentity;
      release(preview());
      await act(async () => preparation);

      expect(latest?.prepared).toBeNull();
      expect(latest?.error).toBe(
        "The target or rubric changed. Prepare it again.",
      );
    }
  });

  it("stops before preview when the editor changes during the save barrier", async () => {
    await render();
    let current = true;
    let releaseSave!: (value: EvaluationIntent) => void;
    const saved = new Promise<EvaluationIntent>(
      (resolve) => (releaseSave = resolve),
    );
    let preparation!: Promise<unknown>;
    act(() => {
      preparation = latest!.prepare({
        identity: identity(),
        isCurrent: () => current,
        resolveIntent: () => saved,
        staleMessage: "The draft changed during preparation.",
      });
    });
    current = false;
    releaseSave(intent);
    await act(async () => preparation);

    expect(api.previewWritingEvaluation).not.toHaveBeenCalled();
    expect(latest?.prepared).toBeNull();
    expect(latest?.error).toBe("The draft changed during preparation.");
  });

  it("does not apply a delayed preview to a newly active document", async () => {
    await render();
    let release!: (value: EvaluationPreview) => void;
    vi.mocked(api.previewWritingEvaluation).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    let preparation!: Promise<unknown>;
    act(() => {
      preparation = latest!.prepare({
        identity: identity(),
        isCurrent: () => true,
        resolveIntent: async () => intent,
        staleMessage: "obsolete",
      });
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      root?.render(createElement(Harness, { documentId: documentTwo }));
    });
    release(preview(documentOne));
    await act(async () => preparation);

    expect(latest?.prepared).toBeNull();
  });

  it("does not apply a delayed submit response to a newly active document", async () => {
    await render();
    await act(async () => {
      await latest?.prepare({
        identity: identity(),
        isCurrent: () => true,
        resolveIntent: async () => intent,
        staleMessage: "obsolete",
      });
    });
    let release!: (value: WritingEvaluationRun) => void;
    vi.mocked(api.submitWritingEvaluation).mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    let submission!: Promise<void>;
    act(() => {
      submission = latest!.submitPrepared(true);
    });
    await act(async () => Promise.resolve());
    await act(async () => {
      root?.render(createElement(Harness, { documentId: documentTwo }));
    });
    release(completedRun(documentOne));
    await act(async () => submission);

    expect(latest?.run).toBeNull();
    expect(latest?.resultRun).toBeNull();
  });

  it("does not let an old poll response replace a newer completed run", async () => {
    await render();
    vi.useFakeTimers();
    try {
      await act(async () => {
        await latest?.prepare({
          identity: identity(),
          isCurrent: () => true,
          resolveIntent: async () => intent,
          staleMessage: "obsolete",
        });
      });
      const queued = {
        ...completedRun(),
        status: "queued" as const,
        providerCalled: false,
        completedAt: undefined,
        result: undefined,
        usage: undefined,
      };
      const newer = {
        ...completedRun(),
        id: "88888888-8888-4888-8888-888888888888",
        requestId: "99999999-9999-4999-8999-999999999999",
        createdAt: "2026-09-22T00:00:00.000Z",
        updatedAt: "2026-09-22T00:00:00.000Z",
        completedAt: "2026-09-22T00:00:00.000Z",
      };
      vi.mocked(api.submitWritingEvaluation)
        .mockResolvedValueOnce(queued)
        .mockResolvedValueOnce(newer);
      await act(async () => latest?.submitPrepared(true));

      let releasePoll!: (value: WritingEvaluationRun) => void;
      vi.mocked(api.loadWritingEvaluation).mockImplementationOnce(
        () => new Promise((resolve) => (releasePoll = resolve)),
      );
      await act(async () => vi.advanceTimersByTimeAsync(500));

      await act(async () => {
        await latest?.prepare({
          identity: identity(),
          isCurrent: () => true,
          resolveIntent: async () => intent,
          staleMessage: "obsolete",
        });
      });
      await act(async () => latest?.submitPrepared(true));
      releasePoll(queued);
      await act(async () => Promise.resolve());

      expect(latest?.run?.id).toBe(newer.id);
      expect(latest?.resultRun?.id).toBe(newer.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries an ambiguous submission with the exact same payload and ingests an immediate result", async () => {
    const previous = {
      ...completedRun(),
      id: "77777777-7777-4777-8777-777777777777",
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
      completedAt: "2026-09-20T00:00:00.000Z",
      result: {
        ...completedRun().result!,
        criteria: [{ criterionId, status: "assessed" as const, mixed: false }],
        providerCalled: true,
      },
      providerCalled: true,
      usage: { inputTokens: 10, outputTokens: 5 },
    };
    vi.mocked(api.listWritingEvaluations).mockResolvedValueOnce([previous]);
    vi.mocked(api.loadWritingEvaluation).mockResolvedValueOnce(previous);
    await render();
    expect(latest?.resultRun?.id).toBe(previous.id);
    await act(async () => {
      await latest?.prepare({
        identity: identity(),
        isCurrent: () => true,
        resolveIntent: async () => intent,
        staleMessage: "obsolete",
      });
    });
    vi.mocked(api.submitWritingEvaluation)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(completedRun());

    await act(async () => latest?.submitPrepared(true));
    expect(latest?.retrySubmission).toBe(true);
    const firstRequest = vi.mocked(api.submitWritingEvaluation).mock
      .calls[0]?.[1];

    await act(async () => latest?.retry());
    const secondRequest = vi.mocked(api.submitWritingEvaluation).mock
      .calls[1]?.[1];
    expect(secondRequest).toEqual(firstRequest);
    expect(secondRequest?.requestId).toBe(firstRequest?.requestId);
    expect(latest?.run?.id).toBe(completedRun().id);
    expect(latest?.resultRun?.id).toBe(completedRun().id);
    expect(latest?.resultRun?.result?.criteria[0]?.status).toBe(
      "incompatible_scope",
    );
    expect(latest?.resultRun?.providerCalled).toBe(false);
    expect(latest?.resultRun?.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(latest?.resultRun?.returnedModel).toBeUndefined();
  });
});
