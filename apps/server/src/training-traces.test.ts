import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TrainingTraceWriter } from "./training-traces.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("TrainingTraceWriter", () => {
  it("does not create a trace file without explicit opt-in", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openloop-trace-off-"));
    directories.push(directory);
    const path = join(directory, "traces.jsonl");
    const writer = new TrainingTraceWriter({ enabled: false, path });

    await writer.recordCandidate({
      requestId: "f9a0423b-6f8d-4195-b116-a32673efdaf5",
      source: "model",
      provider: "ollama",
      model: "qwen2.5:0.5b",
      modelArtifact: "qwen2.5:0.5b",
      promptVersion: "completion.v1",
      documentId: "aac4635f-dd5f-4ce0-a42e-82e2cff2a85a",
      documentVersion: 3,
      nodeId: "ed033693-ee92-4729-a56f-f8f51fdd896e",
      documentTitle: "Private note",
      prefix: "private prefix",
      suffix: "",
      headingPath: [],
      suggestion: " continuation",
      status: "completed",
      decoding: {
        maxOutputTokens: 60,
        temperature: 0.2,
        contextTokens: 2048,
      },
    });

    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("writes joinable candidate and feedback JSONL records when opted in", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openloop-trace-on-"));
    directories.push(directory);
    const path = join(directory, "traces.jsonl");
    const requestId = "f9a0423b-6f8d-4195-b116-a32673efdaf5";
    const writer = new TrainingTraceWriter({
      enabled: true,
      path,
      now: () => new Date("2026-08-19T12:00:00.000Z"),
    });

    await Promise.all([
      writer.recordCandidate({
        requestId,
        source: "model",
        provider: "ollama",
        model: "qwen2.5:0.5b",
        modelArtifact: "qwen2.5:0.5b",
        promptVersion: "completion.v1",
        documentId: "aac4635f-dd5f-4ce0-a42e-82e2cff2a85a",
        documentVersion: 3,
        nodeId: "ed033693-ee92-4729-a56f-f8f51fdd896e",
        documentTitle: "Training note",
        prefix: "The local model",
        suffix: "",
        headingPath: ["Architecture"],
        suggestion: " stays responsive.",
        status: "completed",
        decoding: {
          maxOutputTokens: 60,
          temperature: 0.2,
          contextTokens: 2048,
        },
      }),
      writer.recordFeedback({
        requestId,
        documentId: "aac4635f-dd5f-4ce0-a42e-82e2cff2a85a",
        documentVersion: 3,
        nodeId: "ed033693-ee92-4729-a56f-f8f51fdd896e",
        event: "completion_accepted_full",
        acceptedCharacters: 18,
      }),
    ]);
    await writer.flush();

    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        recordedAt: "2026-08-19T12:00:00.000Z",
        type: "completion_candidate",
        requestId,
        candidateId: requestId,
        promptVersion: "completion.v1",
        prefix: "The local model",
        suggestion: " stays responsive.",
      }),
      expect.objectContaining({
        schemaVersion: 2,
        type: "completion_feedback",
        requestId,
        candidateId: requestId,
        event: "completion_accepted_full",
        acceptedCharacters: 18,
      }),
    ]);
  });
});
