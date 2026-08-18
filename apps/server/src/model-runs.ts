import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { modelRuns } from "./db/schema.js";

export function createModelRun(
  database: Database,
  input: {
    requestId: string;
    documentId?: string;
    kind: "completion" | "critic" | "reconcile" | "repair";
    provider: string;
    model: string;
    inputHash: string;
  },
): string {
  const id = randomUUID();
  database.orm
    .insert(modelRuns)
    .values({
      id,
      requestId: input.requestId,
      documentId: input.documentId,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      inputHash: input.inputHash,
      status: "running",
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export function createCompletionModelRun(
  database: Database,
  input: {
    requestId: string;
    documentId: string;
    provider: string;
    model: string;
    inputHash: string;
  },
): string {
  return createModelRun(database, { ...input, kind: "completion" });
}

export function finishModelRun(
  database: Database,
  input: {
    id: string;
    status: "completed" | "error" | "aborted";
    latencyMs: number;
    errorCode?: string;
  },
): void {
  database.orm
    .update(modelRuns)
    .set({
      status: input.status,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode,
    })
    .where(eq(modelRuns.id, input.id))
    .run();
}
