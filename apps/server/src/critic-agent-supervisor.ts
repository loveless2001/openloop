import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import type { CriticAgentProcessStatus } from "@openloop/shared";

export const CRITIC_AGENT_SESSION_NAME = "openloop-critic" as const;
export const CRITIC_AGENT_ATTACH_COMMAND =
  "tmux attach -t openloop-critic" as const;

function supportsTmux(platform: NodeJS.Platform): boolean {
  return platform === "linux" || platform === "darwin";
}

export function criticAgentPaneTarget(sessionName: string): string {
  return sessionName;
}

interface ProcessResult {
  code: number | null;
  stderr: string;
}

type ProcessRunner = (
  command: string,
  args: string[],
) => Promise<ProcessResult>;

type ExecutableResolver = (command: string) => Promise<string | undefined>;

export interface CriticAgentController {
  status(): Promise<CriticAgentProcessStatus>;
  launch(): Promise<CriticAgentProcessStatus>;
  wake?(prompt: string): Promise<void>;
  resetConversation?(): Promise<void>;
}

export class CriticAgentLaunchError extends Error {
  readonly code = "CRITIC_AGENT_LAUNCH_FAILED";
}

function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ code: null, stderr: "Command timed out." });
    }, 5_000);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.once("error", (error) =>
      finish({ code: null, stderr: error.message }),
    );
    child.once("close", (code) => finish({ code, stderr: stderr.trim() }));
  });
}

async function resolveExecutable(
  command: string,
  pathEnvironment = process.env.PATH ?? "",
): Promise<string | undefined> {
  const candidates =
    isAbsolute(command) || command.includes("/")
      ? [command]
      : pathEnvironment
          .split(delimiter)
          .filter(Boolean)
          .map((directory) => join(directory, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  return undefined;
}

function quoteShellWord(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export class CriticAgentSupervisor implements CriticAgentController {
  private launchPromise?: Promise<CriticAgentProcessStatus>;
  private wakeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      agent: "codex" | "claude";
      command: string;
      cwd: string;
      platform?: NodeJS.Platform;
      run?: ProcessRunner;
      resolve?: ExecutableResolver;
      args?: string[];
      environment?: Record<string, string>;
      submitDelayMs?: number;
    },
  ) {}

  async status(): Promise<CriticAgentProcessStatus> {
    const base = {
      agent: this.options.agent,
      sessionName: CRITIC_AGENT_SESSION_NAME,
      attachCommand: CRITIC_AGENT_ATTACH_COMMAND,
    } as const;
    if (!supportsTmux(this.options.platform ?? process.platform)) {
      return {
        ...base,
        state: "unsupported",
        message:
          "The managed critic terminal requires tmux on macOS or Linux. On Windows, run OpenLoop inside WSL to use the CLI critic.",
      };
    }

    const resolve = this.options.resolve ?? resolveExecutable;
    const tmux = await resolve("tmux");
    if (!tmux) {
      return {
        ...base,
        state: "unavailable",
        message: "tmux is not installed or is not on PATH.",
      };
    }
    const command = await resolve(this.options.command);
    if (!command) {
      return {
        ...base,
        state: "unavailable",
        message: `${this.options.command} is not installed or is not on PATH.`,
      };
    }

    const result = await (this.options.run ?? runProcess)(tmux, [
      "has-session",
      "-t",
      `=${CRITIC_AGENT_SESSION_NAME}`,
    ]);
    if (result.code === 0) {
      return {
        ...base,
        state: "running",
        message: `${this.options.agent} is running in ${CRITIC_AGENT_SESSION_NAME}.`,
      };
    }
    return {
      ...base,
      state: "stopped",
      message: `${this.options.agent} is ready to launch in tmux.`,
    };
  }

  launch(): Promise<CriticAgentProcessStatus> {
    if (this.launchPromise) return this.launchPromise;
    this.launchPromise = this.launchOnce().finally(() => {
      this.launchPromise = undefined;
    });
    return this.launchPromise;
  }

  private async launchOnce(): Promise<CriticAgentProcessStatus> {
    const before = await this.status();
    if (before.state === "running") return before;
    if (before.state !== "stopped") {
      throw new CriticAgentLaunchError(before.message);
    }

    const resolve = this.options.resolve ?? resolveExecutable;
    const tmux = await resolve("tmux");
    const command = await resolve(this.options.command);
    if (!tmux || !command) {
      throw new CriticAgentLaunchError("The critic CLI is unavailable.");
    }
    const result = await (this.options.run ?? runProcess)(tmux, [
      "new-session",
      "-d",
      "-s",
      CRITIC_AGENT_SESSION_NAME,
      "-c",
      this.options.cwd,
      this.buildShellCommand(command),
    ]);
    if (result.code !== 0) {
      const afterFailure = await this.status();
      if (afterFailure.state === "running") return afterFailure;
      throw new CriticAgentLaunchError(
        result.stderr || "tmux could not create the critic session.",
      );
    }

    const after = await this.status();
    if (after.state !== "running") {
      throw new CriticAgentLaunchError(
        `${this.options.agent} exited before its tmux session became ready.`,
      );
    }
    return after;
  }

  private buildShellCommand(command: string): string {
    const environment = Object.entries(this.options.environment ?? {}).map(
      ([key, value]) => `${key}=${value}`,
    );
    const invocation = [command, ...(this.options.args ?? [])]
      .map(quoteShellWord)
      .join(" ");
    return environment.length
      ? `exec env ${environment.map(quoteShellWord).join(" ")} ${invocation}`
      : `exec ${invocation}`;
  }

  wake(prompt: string): Promise<void> {
    const task = this.wakeTail.then(() => this.wakeOnce(prompt));
    this.wakeTail = task.catch(() => undefined);
    return task;
  }

  resetConversation(): Promise<void> {
    return this.wake("/clear");
  }

  private async wakeOnce(prompt: string): Promise<void> {
    const status = await this.status();
    if (status.state !== "running") {
      throw new CriticAgentLaunchError(
        "Start the managed critic CLI before requesting CLI criticism.",
      );
    }
    const resolve = this.options.resolve ?? resolveExecutable;
    const tmux = await resolve("tmux");
    if (!tmux) throw new CriticAgentLaunchError("tmux is unavailable.");
    const run = this.options.run ?? runProcess;
    const paneTarget = criticAgentPaneTarget(CRITIC_AGENT_SESSION_NAME);
    const typed = await run(tmux, [
      "send-keys",
      "-t",
      paneTarget,
      "-l",
      prompt,
    ]);
    if (typed.code !== 0) {
      throw new CriticAgentLaunchError(
        typed.stderr || "Could not type into the critic terminal.",
      );
    }
    await delay(this.options.submitDelayMs ?? 100);
    const submitted = await run(tmux, ["send-keys", "-t", paneTarget, "C-m"]);
    if (submitted.code !== 0) {
      throw new CriticAgentLaunchError(
        submitted.stderr || "Could not submit the critic wake prompt.",
      );
    }
  }
}
