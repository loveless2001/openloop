import type { IssueRecord } from "@openloop/core";
import type { TextBlockSnapshot } from "@openloop/shared";

import { ModelAdapterError } from "./model-error.js";
import type {
  CompletionChunk,
  CompletionInput,
  CriticInput,
  ModelAdapter,
  ReconcileInput,
} from "./types.js";

const TRIGGER = "any model will work equally well";

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ModelAdapterError(
      "MODEL_ABORTED",
      "The model request was aborted.",
    );
  }
}

function completionFor(prefix: string): string {
  const normalized = prefix.toLocaleLowerCase();
  if (
    normalized.includes("model agnostic") ||
    normalized.includes("any model")
  ) {
    return " because interface compatibility does not guarantee equivalent quality.";
  }
  if (prefix.trimEnd().endsWith("."))
    return " This distinction matters in practice.";
  return " while keeping the argument precise.";
}

function findTrigger(blocks: TextBlockSnapshot[]): {
  block: TextBlockSnapshot;
  quote: string;
} | null {
  for (const block of blocks) {
    const start = block.text.toLocaleLowerCase().indexOf(TRIGGER);
    if (start >= 0) {
      return { block, quote: block.text.slice(start, start + TRIGGER.length) };
    }
  }
  return null;
}

function hasRelatedKeywords(issue: IssueRecord, text: string): boolean {
  const normalized = text.toLocaleLowerCase();
  return issue.keywords.some((keyword) =>
    normalized.includes(keyword.toLocaleLowerCase()),
  );
}

export class MockModelAdapter implements ModelAdapter {
  readonly providerId = "mock";
  readonly capabilities = {
    streaming: true,
    jsonSchema: true,
    cancellation: true,
  } as const;

  async *streamCompletion(
    input: CompletionInput,
    signal: AbortSignal,
  ): AsyncIterable<CompletionChunk> {
    const completion = completionFor(input.prefix);
    const chunks = completion.match(/.{1,18}(?:\s|$)/g) ?? [completion];

    for (const textDelta of chunks) {
      throwIfAborted(signal);
      await Promise.resolve();
      throwIfAborted(signal);
      yield { textDelta, done: false };
    }
    yield { textDelta: "", done: true };
  }

  async critique(input: CriticInput, signal: AbortSignal) {
    throwIfAborted(signal);
    const match = findTrigger(input.changedBlocks);
    if (!match) return [];

    return [
      {
        type: "ambiguity" as const,
        anchorQuote: match.quote,
        question:
          "Do you mean that any model can be integrated through the same interface, or that all models will produce equivalent behavior and quality?",
        rationale:
          "Integration portability and equivalent model behavior are different claims.",
        suggestedRewrite:
          "models can share an interface while differing in behavior and quality",
        severity: 4 as const,
        confidence: 0.98,
        interruptWorthiness: 0.95,
        resurfaceTriggers: ["claim_reused" as const, "section_end" as const],
        keywords: ["model", "interface", "quality"],
      },
    ];
  }

  async reconcile(input: ReconcileInput, signal: AbortSignal) {
    throwIfAborted(signal);
    const currentText = input.currentBlock?.text ?? "";
    const normalized = currentText.toLocaleLowerCase();
    if (
      normalized.includes("api-compatible") &&
      normalized.includes("quality")
    ) {
      return {
        outcome: "resolved" as const,
        reason:
          "The revision distinguishes API compatibility from model quality.",
        confidence: 0.98,
      };
    }

    if (
      currentText &&
      !currentText.includes(input.issue.anchor.quote) &&
      !hasRelatedKeywords(input.issue, currentText)
    ) {
      return {
        outcome: "invalidated" as const,
        reason: "The anchored claim and its related keywords are absent.",
        confidence: 0.9,
      };
    }

    return {
      outcome: "persists" as const,
      reason: "The underlying distinction remains unresolved.",
      confidence: 0.9,
      ...(currentText.includes(input.issue.anchor.quote)
        ? { newAnchorQuote: input.issue.anchor.quote }
        : {}),
    };
  }
}
