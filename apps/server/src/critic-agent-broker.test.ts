import { describe, expect, it, vi } from "vitest";

import {
  CriticAgentBroker,
  CriticAgentBrokerError,
} from "./critic-agent-broker.js";

const input = {
  requestId: "b2c099ea-47cf-4ee7-829d-61a5bccf5fdb",
  documentTitle: "Argument",
  documentVersion: 2,
  scope: { kind: "changes" as const },
  changedBlocks: [
    {
      nodeId: "24ed13e0-e0a8-4355-8f21-d8132558e008",
      nodeType: "paragraph" as const,
      text: "Any model will work equally well.",
      headingPath: [],
    },
  ],
  contextPolicy: {
    canRequestMore: true,
    maxRequests: 2,
    maxBlocksPerSide: 6,
  },
  openIssues: [],
};

describe("CriticAgentBroker", () => {
  it("leases a bounded job and resolves only a matching submission", async () => {
    const broker = new CriticAgentBroker(30_000);
    const pending = broker.enqueue(input, new AbortController().signal);
    const claim = broker.claim();

    expect(claim).toMatchObject({ jobId: pending.jobId, job: input });
    expect(claim?.leaseToken).toHaveLength(64);
    expect(() => broker.submit(pending.jobId, "0".repeat(64), [])).toThrow(
      CriticAgentBrokerError,
    );

    broker.submit(pending.jobId, claim!.leaseToken, []);
    await expect(pending.result).resolves.toEqual([]);
    expect(broker.getStatus()).toEqual({ pending: 0, leased: 0 });
  });

  it("rejects an aborted job and makes a later submission stale", async () => {
    const broker = new CriticAgentBroker(30_000);
    const controller = new AbortController();
    const pending = broker.enqueue(input, controller.signal);
    const claim = broker.claim();
    controller.abort();

    await expect(pending.result).rejects.toMatchObject({
      code: "MODEL_ABORTED",
    });
    expect(() => broker.submit(pending.jobId, claim!.leaseToken, [])).toThrow(
      "no longer active",
    );
  });

  it("allows only one active lease and exposes queued work after submission", async () => {
    const broker = new CriticAgentBroker(30_000);
    const first = broker.enqueue(input, new AbortController().signal);
    const second = broker.enqueue(
      { ...input, requestId: "71c3206c-ea69-4f6c-ab75-55b7d44e1277" },
      new AbortController().signal,
    );
    expect(first.shouldWake).toBe(true);
    expect(second.shouldWake).toBe(false);

    const firstClaim = broker.claim();
    expect(broker.claim()).toBeNull();
    expect(broker.submit(first.jobId, firstClaim!.leaseToken, [])).toBe(true);
    await expect(first.result).resolves.toEqual([]);

    const secondClaim = broker.claim();
    expect(secondClaim?.jobId).toBe(second.jobId);
    broker.submit(second.jobId, secondClaim!.leaseToken, []);
    await expect(second.result).resolves.toEqual([]);
  });

  it("serves bounded context only to the active lease", async () => {
    const broker = new CriticAgentBroker(30_000);
    const contextProvider = vi.fn(async () => ({
      beforeBlocks: [{ ...input.changedBlocks[0]!, text: "Before." }],
      afterBlocks: [{ ...input.changedBlocks[0]!, text: "After." }],
    }));
    const pending = broker.enqueue(
      input,
      new AbortController().signal,
      contextProvider,
    );
    const claim = broker.claim();

    await expect(
      broker.requestContext(pending.jobId, claim!.leaseToken, {
        beforeBlocks: 1,
        afterBlocks: 1,
      }),
    ).resolves.toMatchObject({
      beforeBlocks: [{ text: "Before." }],
      afterBlocks: [{ text: "After." }],
    });
    expect(contextProvider).toHaveBeenCalledOnce();
    await expect(
      broker.requestContext(pending.jobId, "0".repeat(64), {
        beforeBlocks: 1,
        afterBlocks: 0,
      }),
    ).rejects.toThrow("lease is invalid");

    broker.submit(pending.jobId, claim!.leaseToken, []);
    await pending.result;
  });
});
