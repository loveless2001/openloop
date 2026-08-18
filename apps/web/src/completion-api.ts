import {
  ApiErrorSchema,
  type CompletionInteractionRequest,
  type CompletionStreamRequest,
} from "@openloop/shared";
import { z } from "zod";

const deltaSchema = z.object({ text: z.string() });
const doneSchema = z.object({ requestId: z.uuid() });
const streamErrorSchema = z.object({ code: z.string(), message: z.string() });

export class CompletionStreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function parseEventBlock(
  block: string,
): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: JSON.parse(dataLines.join("\n")) };
}

export async function streamCompletion(
  input: CompletionStreamRequest,
  signal: AbortSignal,
  handlers: {
    onDelta: (text: string) => void | Promise<void>;
    onDone: () => void | Promise<void>;
  },
): Promise<void> {
  const response = await fetch("/v1/completions/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const payload: unknown = await response.json();
    const error = ApiErrorSchema.parse(payload).error;
    throw new CompletionStreamError(error.code, error.message);
  }
  if (!response.body) {
    throw new CompletionStreamError(
      "MODEL_UNAVAILABLE",
      "Completion stream is unavailable.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : (blocks.pop() ?? "");

    for (const block of blocks) {
      const parsed = parseEventBlock(block);
      if (!parsed) continue;
      if (parsed.event === "delta") {
        await handlers.onDelta(deltaSchema.parse(parsed.data).text);
      } else if (parsed.event === "done") {
        doneSchema.parse(parsed.data);
        await handlers.onDone();
        return;
      } else if (parsed.event === "error") {
        const error = streamErrorSchema.parse(parsed.data);
        throw new CompletionStreamError(error.code, error.message);
      }
    }

    if (done) return;
  }
}

export function logCompletionInteraction(
  event: CompletionInteractionRequest,
): void {
  void fetch("/v1/completion-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}
