import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { OllamaRuntime } from "./ollama-runtime.js";

class FakeOllamaProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit");
    return true;
  }
}

describe("OllamaRuntime", () => {
  it("reuses an existing server and verifies the configured model", async () => {
    const startProcess = vi.fn(() => new FakeOllamaProcess());
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      return url.endsWith("/api/version")
        ? Response.json({ version: "test" })
        : Response.json({ models: [{ name: "qwen2.5:0.5b" }] });
    });
    const runtime = new OllamaRuntime({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:0.5b",
      fetchImplementation,
      startProcess,
    });

    await runtime.ensureReady();

    expect(startProcess).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("starts and later stops a local server when none is running", async () => {
    const process = new FakeOllamaProcess();
    const startProcess = vi.fn(() => process);
    let versionProbes = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/version")) {
        versionProbes += 1;
        if (versionProbes === 1) throw new Error("connection refused");
        return Response.json({ version: "test" });
      }
      return Response.json({ models: [{ model: "qwen2.5:0.5b" }] });
    });
    const runtime = new OllamaRuntime({
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5:0.5b",
      fetchImplementation,
      startProcess,
      pollIntervalMs: 0,
    });

    await runtime.ensureReady();
    await runtime.shutdown();

    expect(startProcess).toHaveBeenCalledTimes(1);
    expect(process.killed).toBe(true);
  });

  it("rejects an installation without the configured model", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/api/version")
        ? Response.json({ version: "test" })
        : Response.json({ models: [] }),
    );
    const runtime = new OllamaRuntime({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:0.5b",
      fetchImplementation,
    });

    await expect(runtime.ensureReady()).rejects.toThrow("pnpm setup:ollama");
  });

  it("does not launch a local process for an unavailable remote endpoint", async () => {
    const startProcess = vi.fn(() => new FakeOllamaProcess());
    const runtime = new OllamaRuntime({
      baseUrl: "http://models.example.test:11434/v1",
      model: "qwen2.5:0.5b",
      fetchImplementation: vi.fn<typeof fetch>(async () => {
        throw new Error("connection refused");
      }),
      startProcess,
    });

    await expect(runtime.ensureReady()).rejects.toThrow(
      "only starts local Ollama endpoints",
    );
    expect(startProcess).not.toHaveBeenCalled();
  });
});
