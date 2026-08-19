// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  launch: vi.fn(),
  load: vi.fn(),
}));

vi.mock("./api.js", () => ({
  launchCriticAgent: api.launch,
  loadCriticAgentStatus: api.load,
}));

import { CriticAgentControl } from "./CriticAgentControl.js";

describe("CriticAgentControl", () => {
  it("launches a stopped fixed session and displays running status", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const stopped = {
      state: "stopped" as const,
      agent: "codex" as const,
      sessionName: "openloop-critic" as const,
      attachCommand: "tmux attach -t openloop-critic" as const,
      message: "codex is ready to launch in tmux.",
      bridgeState: "idle" as const,
      pendingJobs: 0,
    };
    const running = {
      ...stopped,
      state: "running" as const,
      message: "codex is running in openloop-critic.",
    };
    api.load.mockResolvedValue(stopped);
    api.launch.mockResolvedValue(running);
    const onMessage = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(CriticAgentControl, { onMessage }));
    });
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Start codex CLI");

    await act(async () => button?.click());

    expect(api.launch).toHaveBeenCalledOnce();
    expect(button?.textContent).toContain("codex CLI running");
    expect(button?.disabled).toBe(true);
    expect(onMessage).toHaveBeenCalledWith(
      "codex critic terminal started. If login is requested, attach with: tmux attach -t openloop-critic",
      5_000,
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
