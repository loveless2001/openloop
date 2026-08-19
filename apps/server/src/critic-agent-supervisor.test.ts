import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  criticAgentPaneTarget,
  CriticAgentSupervisor,
} from "./critic-agent-supervisor.js";

describe("CriticAgentSupervisor", () => {
  it("reports unsupported platforms without probing commands", async () => {
    const resolve = vi.fn();
    const supervisor = new CriticAgentSupervisor({
      agent: "codex",
      command: "codex",
      cwd: "/workspace",
      platform: "darwin",
      resolve,
    });

    await expect(supervisor.status()).resolves.toMatchObject({
      state: "unsupported",
      sessionName: "openloop-critic",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("reports a missing configured CLI", async () => {
    const supervisor = new CriticAgentSupervisor({
      agent: "claude",
      command: "claude",
      cwd: "/workspace",
      platform: "linux",
      resolve: async (command) =>
        command === "tmux" ? "/usr/bin/tmux" : undefined,
    });

    await expect(supervisor.status()).resolves.toEqual({
      state: "unavailable",
      agent: "claude",
      sessionName: "openloop-critic",
      attachCommand: "tmux attach -t openloop-critic",
      message: "claude is not installed or is not on PATH.",
    });
  });

  it("launches one fixed detached session and then reports it running", async () => {
    let running = false;
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "has-session") {
        return { code: running ? 0 : 1, stderr: "" };
      }
      expect(args).toEqual([
        "new-session",
        "-d",
        "-s",
        "openloop-critic",
        "-c",
        "/workspace",
        "exec env 'OPENLOOP_MCP_TOKEN=secret' '/usr/bin/codex' '-c' 'mcp_servers.openloop.url=\"http://127.0.0.1:8787/mcp\"'",
      ]);
      running = true;
      return { code: 0, stderr: "" };
    });
    const supervisor = new CriticAgentSupervisor({
      agent: "codex",
      command: "codex",
      cwd: "/workspace",
      platform: "linux",
      args: ["-c", 'mcp_servers.openloop.url="http://127.0.0.1:8787/mcp"'],
      environment: { OPENLOOP_MCP_TOKEN: "secret" },
      resolve: async (command) => `/usr/bin/${command}`,
      run,
    });

    await expect(supervisor.launch()).resolves.toMatchObject({
      state: "running",
      agent: "codex",
      attachCommand: "tmux attach -t openloop-critic",
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("injects one literal wake prompt followed by carriage return", async () => {
    const run = vi.fn(async (_command: string, args: string[]) => ({
      code: args[0] === "has-session" || args[0] === "send-keys" ? 0 : 1,
      stderr: "",
    }));
    const supervisor = new CriticAgentSupervisor({
      agent: "codex",
      command: "codex",
      cwd: "/workspace",
      platform: "linux",
      resolve: async (command) => `/usr/bin/${command}`,
      run,
      submitDelayMs: 0,
    });

    await supervisor.wake("Call openloop_critic_next now.");

    expect(run).toHaveBeenNthCalledWith(2, "/usr/bin/tmux", [
      "send-keys",
      "-t",
      "openloop-critic",
      "-l",
      "Call openloop_critic_next now.",
    ]);
    expect(run).toHaveBeenNthCalledWith(3, "/usr/bin/tmux", [
      "send-keys",
      "-t",
      "openloop-critic",
      "C-m",
    ]);

    await supervisor.resetConversation();
    expect(run).toHaveBeenNthCalledWith(5, "/usr/bin/tmux", [
      "send-keys",
      "-t",
      "openloop-critic",
      "-l",
      "/clear",
    ]);
    expect(run).toHaveBeenNthCalledWith(6, "/usr/bin/tmux", [
      "send-keys",
      "-t",
      "openloop-critic",
      "C-m",
    ]);
  });

  it.runIf(spawnSync("tmux", ["-V"]).status === 0)(
    "submits a completed line to a real tmux pane",
    async (context) => {
      const sessionName = `openloop-target-${randomUUID()}`;
      const directory = mkdtempSync(join(tmpdir(), "openloop-tmux-"));
      const outputPath = join(directory, "submitted.txt");
      const prompt = "Critique this selection now.";
      const created = spawnSync("tmux", [
        "new-session",
        "-d",
        "-s",
        sessionName,
        "bash",
        "-c",
        'IFS= read -r line; printf "%s" "$line" > "$1"',
        "bash",
        outputPath,
      ]);
      if (
        created.status !== 0 &&
        /operation not permitted|permission denied/i.test(
          created.stderr.toString(),
        )
      ) {
        context.skip();
        return;
      }
      expect(created.status, created.stderr.toString()).toBe(0);
      try {
        const target = criticAgentPaneTarget(sessionName);
        const typed = spawnSync("tmux", [
          "send-keys",
          "-t",
          target,
          "-l",
          prompt,
        ]);
        expect(typed.status, typed.stderr.toString()).toBe(0);
        const submitted = spawnSync("tmux", ["send-keys", "-t", target, "C-m"]);
        expect(submitted.status, submitted.stderr.toString()).toBe(0);
        await vi.waitFor(
          () => expect(readFileSync(outputPath, "utf8")).toBe(prompt),
          { timeout: 1_000, interval: 10 },
        );
      } finally {
        spawnSync("tmux", ["kill-session", "-t", `=${sessionName}`]);
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
