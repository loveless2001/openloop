import { describe, expect, it, vi } from "vitest";

import { CriticCliCoordinator } from "./critic-cli-coordinator.js";

describe("CriticCliCoordinator", () => {
  it("clears only when the active issue changes and serializes turns", async () => {
    const resetConversation = vi.fn(async () => undefined);
    const order: string[] = [];
    const coordinator = new CriticCliCoordinator({
      status: vi.fn(),
      launch: vi.fn(),
      resetConversation,
    });

    await coordinator.activateIssue("issue-a");
    await coordinator.activateIssue("issue-a");
    await coordinator.runIssueTurn("issue-a", async () => order.push("a"));
    await coordinator.runIssueTurn("issue-b", async () => order.push("b"));
    await coordinator.runCriticTurn(async () => order.push("critic"));
    await coordinator.runCriticTurn(async () => order.push("critic-2"));

    expect(order).toEqual(["a", "b", "critic", "critic-2"]);
    expect(resetConversation).toHaveBeenCalledTimes(3);
  });
});
