import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

interface ManagedOllamaProcess {
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: () => void): this;
}

interface OllamaRuntimeConfig {
  baseUrl: string;
  model: string;
  fetchImplementation?: typeof fetch;
  startProcess?: () => ManagedOllamaProcess;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

function nativeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function isLocalOllama(baseUrl: string): boolean {
  const hostname = new URL(baseUrl).hostname;
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  );
}

function ollamaProcessEnvironment(baseUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OLLAMA_HOST: new URL(nativeBaseUrl(baseUrl)).host,
  };
}

export class OllamaRuntime {
  private readonly fetchImplementation: typeof fetch;
  private readonly startProcess: () => ManagedOllamaProcess;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private process?: ManagedOllamaProcess;
  private bootPromise?: Promise<void>;

  constructor(private readonly config: OllamaRuntimeConfig) {
    this.fetchImplementation = config.fetchImplementation ?? fetch;
    this.startProcess =
      config.startProcess ??
      (() =>
        spawn("ollama", ["serve"], {
          env: ollamaProcessEnvironment(config.baseUrl),
          stdio: "ignore",
          windowsHide: true,
        }));
    this.startupTimeoutMs = config.startupTimeoutMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 250;
  }

  ensureReady(): Promise<void> {
    if (!this.bootPromise) {
      this.bootPromise = this.startAndVerify().catch((error: unknown) => {
        this.bootPromise = undefined;
        throw error;
      });
    }
    return this.bootPromise;
  }

  async shutdown(): Promise<void> {
    const process = this.process;
    this.process = undefined;
    this.bootPromise = undefined;
    if (!process || process.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      process.once("exit", finish);
      process.kill("SIGTERM");
      setTimeout(finish, 2_000).unref();
    });
  }

  private async startAndVerify(): Promise<void> {
    if (!(await this.isServing())) {
      if (!isLocalOllama(this.config.baseUrl)) {
        throw new Error(
          `Ollama is unavailable at ${nativeBaseUrl(this.config.baseUrl)}. OpenLoop only starts local Ollama endpoints automatically.`,
        );
      }
      await this.startLocalServer();
    }
    await this.verifyModelInstalled();
  }

  private async startLocalServer(): Promise<void> {
    let startupError: Error | undefined;
    const process = this.startProcess();
    this.process = process;
    process.once("error", (error) => {
      startupError = error;
    });

    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (startupError) {
        throw new Error(
          "Could not start Ollama. Install Ollama and ensure the `ollama` command is on PATH.",
          { cause: startupError },
        );
      }
      if (process.exitCode !== null) {
        throw new Error(
          `Ollama exited during startup with code ${process.exitCode}.`,
        );
      }
      if (await this.isServing()) return;
      await delay(this.pollIntervalMs);
    }
    throw new Error(
      `Ollama did not become ready within ${this.startupTimeoutMs} ms.`,
    );
  }

  private async isServing(): Promise<boolean> {
    try {
      const response = await this.fetchImplementation(
        `${nativeBaseUrl(this.config.baseUrl)}/api/version`,
        { signal: AbortSignal.timeout(1_000) },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  private async verifyModelInstalled(): Promise<void> {
    const response = await this.fetchImplementation(
      `${nativeBaseUrl(this.config.baseUrl)}/api/tags`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) {
      throw new Error(
        `Could not inspect Ollama models (HTTP ${response.status}).`,
      );
    }
    const payload = (await response.json()) as OllamaTagsResponse;
    const installed = payload.models?.some(
      ({ name, model }) =>
        name === this.config.model || model === this.config.model,
    );
    if (!installed) {
      throw new Error(
        `Ollama model ${this.config.model} is not installed. Run \`pnpm setup:ollama\` before starting OpenLoop.`,
      );
    }
  }
}
