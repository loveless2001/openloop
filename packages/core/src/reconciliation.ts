import type {
  ReconcileResultSchema,
  TextBlockSnapshot,
} from "@openloop/shared";
import type { z } from "zod";

import {
  normalizeIssueText,
  tokenJaccard,
  type IssueRecord,
} from "./issues.js";

type ReconcileResult = z.infer<typeof ReconcileResultSchema>;

export type AnchorRemapKind = "exact" | "remapped" | "detached";

export interface AnchorRemapResult {
  issue: IssueRecord;
  kind: AnchorRemapKind;
  needsReconciliation: boolean;
  headingPath?: string[];
  score?: number;
}

export interface ReconciliationTransitionResult {
  issue: IssueRecord;
  action:
    | "reconciled_persists"
    | "reconciled_resolved"
    | "reconciled_invalidated"
    | "reconciled_uncertain";
  result: ReconcileResult;
}

interface AnchorMatch {
  block: TextBlockSnapshot;
  quote: string;
  quoteStart: number;
  quoteEnd: number;
  score: number;
}

interface RangeMapping {
  start: number;
  end: number;
}

function sameHeading(left: string[], right: string[]): boolean {
  return left.join("\u0000") === right.join("\u0000");
}

export function normalizedLevenshteinSimilarity(
  leftValue: string,
  rightValue: string,
): number {
  const left = normalizeIssueText(leftValue);
  const right = normalizeIssueText(rightValue);
  if (left === right) return 1;
  if (!left || !right) return 0;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1]! +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        substitution,
      );
    }
    previous = current;
  }
  return 1 - previous[right.length]! / Math.max(left.length, right.length);
}

function surroundingContext(text: string, start: number, end: number) {
  return {
    left: text.slice(Math.max(0, start - 80), start),
    right: text.slice(end, end + 80),
  };
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(
  left: string,
  right: string,
  prefixLength: number,
): number {
  const limit = Math.min(left.length, right.length) - prefixLength;
  let length = 0;
  while (
    length < limit &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}

/**
 * Maps a range through one contiguous edit. Ranges intersecting the edit are
 * deliberately rejected so quote recovery can fail closed instead of
 * pretending an edited selection still has the same meaning.
 */
function mapRangeThroughEdit(
  previousText: string,
  currentText: string,
  start: number,
  end: number,
): RangeMapping | undefined {
  if (start < 0 || end < start || end > previousText.length) return;
  const prefixLength = commonPrefixLength(previousText, currentText);
  const suffixLength = commonSuffixLength(
    previousText,
    currentText,
    prefixLength,
  );
  const previousChangedEnd = previousText.length - suffixLength;
  const currentChangedEnd = currentText.length - suffixLength;

  if (end <= prefixLength) return { start, end };
  if (start >= previousChangedEnd) {
    const shift = currentChangedEnd - previousChangedEnd;
    return { start: start + shift, end: end + shift };
  }
  return;
}

function contextSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeIssueText(left);
  const normalizedRight = normalizeIssueText(right);
  if (!normalizedLeft && !normalizedRight) return 1;
  if (!normalizedLeft || !normalizedRight) return 0;
  return normalizedLevenshteinSimilarity(normalizedLeft, normalizedRight);
}

function exactOccurrences(text: string, quote: string): number[] {
  const starts: number[] = [];
  let offset = 0;
  while (offset <= text.length - quote.length) {
    const start = text.indexOf(quote, offset);
    if (start < 0) break;
    starts.push(start);
    offset = start + Math.max(1, quote.length);
  }
  return starts;
}

function exactOccurrenceMatch(
  issue: IssueRecord,
  block: TextBlockSnapshot,
): AnchorMatch | undefined {
  const starts = exactOccurrences(block.text, issue.anchor.quote);
  if (starts.length === 0) return;
  if (starts.length === 1) {
    const start = starts[0]!;
    return {
      block,
      quote: issue.anchor.quote,
      quoteStart: start,
      quoteEnd: start + issue.anchor.quote.length,
      score: 1,
    };
  }

  const scored = starts
    .map((start) => {
      const end = start + issue.anchor.quote.length;
      const context = surroundingContext(block.text, start, end);
      return {
        start,
        score:
          0.5 * contextSimilarity(issue.anchor.leftContext, context.left) +
          0.5 * contextSimilarity(issue.anchor.rightContext, context.right),
      };
    })
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || best.score < 0.7) return;
  if (runnerUp && best.score - runnerUp.score < 0.15) return;
  return {
    block,
    quote: issue.anchor.quote,
    quoteStart: best.start,
    quoteEnd: best.start + issue.anchor.quote.length,
    score: best.score,
  };
}

function scoreCandidate(
  issue: IssueRecord,
  originalHeading: string[],
  block: TextBlockSnapshot,
  quote: string,
  start: number,
  end: number,
): number {
  const context = surroundingContext(block.text, start, end);
  return (
    0.5 * tokenJaccard(issue.anchor.quote, quote) +
    0.2 * tokenJaccard(issue.anchor.leftContext, context.left) +
    0.2 * tokenJaccard(issue.anchor.rightContext, context.right) +
    0.1 * (sameHeading(originalHeading, block.headingPath) ? 1 : 0)
  );
}

function candidateWindows(text: string, targetTokenCount: number) {
  const tokens = [...text.matchAll(/\S+/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const windows: Array<{ quote: string; start: number; end: number }> = [];
  const minimum = Math.max(1, targetTokenCount - 2);
  const maximum = targetTokenCount + 2;
  for (let startIndex = 0; startIndex < tokens.length; startIndex += 1) {
    for (let size = minimum; size <= maximum; size += 1) {
      const endToken = tokens[startIndex + size - 1];
      const startToken = tokens[startIndex];
      if (!startToken || !endToken) continue;
      windows.push({
        start: startToken.start,
        end: endToken.end,
        quote: text.slice(startToken.start, endToken.end),
      });
    }
  }
  return windows;
}

function bestMatch(
  issue: IssueRecord,
  originalHeading: string[],
  blocks: TextBlockSnapshot[],
): AnchorMatch | undefined {
  const targetTokenCount = Math.max(
    1,
    normalizeIssueText(issue.anchor.quote).split(" ").filter(Boolean).length,
  );
  const matches: AnchorMatch[] = [];
  for (const block of blocks) {
    for (const candidate of candidateWindows(block.text, targetTokenCount)) {
      const score = scoreCandidate(
        issue,
        originalHeading,
        block,
        candidate.quote,
        candidate.start,
        candidate.end,
      );
      matches.push({
        block,
        score,
        quote: candidate.quote,
        quoteStart: candidate.start,
        quoteEnd: candidate.end,
      });
    }
  }
  matches.sort((left, right) => right.score - left.score);
  const best = matches[0];
  if (!best) return;
  const minimumSeparation = Math.max(3, best.quote.length / 2);
  const runnerUp = matches.find(
    (candidate) =>
      candidate.block.nodeId !== best.block.nodeId ||
      Math.abs(candidate.quoteStart - best.quoteStart) > minimumSeparation,
  );
  if (runnerUp && best.score - runnerUp.score < 0.08) return;
  return best;
}

function issueWithAnchor(
  issue: IssueRecord,
  match: AnchorMatch,
  documentVersion: number,
  now: Date,
): IssueRecord {
  const context = surroundingContext(
    match.block.text,
    match.quoteStart,
    match.quoteEnd,
  );
  return {
    ...issue,
    anchor: {
      ...issue.anchor,
      nodeId: match.block.nodeId,
      quote: match.quote,
      quoteStart: match.quoteStart,
      quoteEnd: match.quoteEnd,
      leftContext: context.left,
      rightContext: context.right,
      sourceDocumentVersion: documentVersion,
      detached: false,
    },
    updatedAt: now.toISOString(),
  };
}

function exactMatch(
  issue: IssueRecord,
  previousBlock: TextBlockSnapshot | undefined,
  block: TextBlockSnapshot,
): AnchorMatch | undefined {
  if (
    previousBlock &&
    issue.anchor.quoteStart !== undefined &&
    issue.anchor.quoteEnd !== undefined
  ) {
    const mapped = mapRangeThroughEdit(
      previousBlock.text,
      block.text,
      issue.anchor.quoteStart,
      issue.anchor.quoteEnd,
    );
    if (
      mapped &&
      block.text.slice(mapped.start, mapped.end) === issue.anchor.quote
    ) {
      return {
        block,
        quote: issue.anchor.quote,
        quoteStart: mapped.start,
        quoteEnd: mapped.end,
        score: 1,
      };
    }
  }
  return exactOccurrenceMatch(issue, block);
}

export function remapIssueAnchor(input: {
  issue: IssueRecord;
  previousBlocks: TextBlockSnapshot[];
  currentBlocks: TextBlockSnapshot[];
  mergedNodeMap: Record<string, string>;
  documentVersion: number;
  now: Date;
}): AnchorRemapResult {
  const originalBlock = input.previousBlocks.find(
    (block) => block.nodeId === input.issue.anchor.nodeId,
  );
  const originalHeading = originalBlock?.headingPath ?? [];
  const sameNode = input.currentBlocks.find(
    (block) => block.nodeId === input.issue.anchor.nodeId,
  );
  const exact = sameNode
    ? exactMatch(input.issue, originalBlock, sameNode)
    : undefined;
  if (exact) {
    const materiallyChanged = originalBlock
      ? normalizedLevenshteinSimilarity(originalBlock.text, sameNode!.text) <
        0.92
      : true;
    return {
      issue: issueWithAnchor(
        input.issue,
        exact,
        input.documentVersion,
        input.now,
      ),
      kind: "exact",
      needsReconciliation: materiallyChanged,
      headingPath: sameNode!.headingPath,
      score: 1,
    };
  }

  if (sameNode) {
    const match = bestMatch(input.issue, originalHeading, [sameNode]);
    if (match && match.score >= 0.82) {
      return {
        issue: issueWithAnchor(
          input.issue,
          match,
          input.documentVersion,
          input.now,
        ),
        kind: "remapped",
        needsReconciliation: true,
        headingPath: match.block.headingPath,
        score: match.score,
      };
    }
  }

  const mergedNodeId = input.mergedNodeMap[input.issue.anchor.nodeId];
  const mergedBlock = mergedNodeId
    ? input.currentBlocks.find((block) => block.nodeId === mergedNodeId)
    : undefined;
  if (mergedBlock) {
    const match = bestMatch(input.issue, originalHeading, [mergedBlock]);
    if (match && match.score >= 0.78) {
      return {
        issue: issueWithAnchor(
          input.issue,
          match,
          input.documentVersion,
          input.now,
        ),
        kind: "remapped",
        needsReconciliation: true,
        headingPath: match.block.headingPath,
        score: match.score,
      };
    }
  }

  const previousIndex = input.previousBlocks.findIndex(
    (block) => block.nodeId === input.issue.anchor.nodeId,
  );
  const nearbySurvivorIds =
    previousIndex < 0
      ? new Set<string>()
      : new Set(
          input.previousBlocks
            .slice(Math.max(0, previousIndex - 2), previousIndex + 3)
            .map((block) => block.nodeId),
        );
  const survivorIndexes = input.currentBlocks
    .map((block, index) => (nearbySurvivorIds.has(block.nodeId) ? index : -1))
    .filter((index) => index >= 0);
  const neighborBlocks = input.currentBlocks.filter(
    (block, index) =>
      survivorIndexes.some(
        (survivorIndex) => Math.abs(index - survivorIndex) <= 2,
      ) && sameHeading(originalHeading, block.headingPath),
  );
  const neighbor = bestMatch(input.issue, originalHeading, neighborBlocks);
  if (neighbor && neighbor.score >= 0.86) {
    return {
      issue: issueWithAnchor(
        input.issue,
        neighbor,
        input.documentVersion,
        input.now,
      ),
      kind: "remapped",
      needsReconciliation: true,
      headingPath: neighbor.block.headingPath,
      score: neighbor.score,
    };
  }

  return {
    issue: {
      ...input.issue,
      status: "needs_review",
      anchor: { ...input.issue.anchor, detached: true },
      resolvedAt: undefined,
      updatedAt: input.now.toISOString(),
    },
    kind: "detached",
    needsReconciliation: true,
  };
}

export function applyReconciliationResult(input: {
  issue: IssueRecord;
  result: ReconcileResult;
  currentBlock?: TextBlockSnapshot;
  documentVersion: number;
  now: Date;
}): ReconciliationTransitionResult {
  let result = input.result;
  if (
    input.issue.severity === 5 &&
    (result.outcome === "resolved" || result.outcome === "invalidated") &&
    result.confidence < 0.7
  ) {
    result = {
      outcome: "uncertain",
      reason: result.reason,
      confidence: result.confidence,
    };
  }

  const updatedAt = input.now.toISOString();
  if (result.outcome === "resolved") {
    return {
      issue: {
        ...input.issue,
        status: "resolved",
        snoozedUntil: undefined,
        resolvedAt: updatedAt,
        updatedAt,
      },
      action: "reconciled_resolved",
      result,
    };
  }
  if (result.outcome === "invalidated") {
    return {
      issue: {
        ...input.issue,
        status: "invalidated",
        snoozedUntil: undefined,
        resolvedAt: undefined,
        updatedAt,
      },
      action: "reconciled_invalidated",
      result,
    };
  }
  if (result.outcome === "uncertain") {
    return {
      issue: {
        ...input.issue,
        status: "needs_review",
        snoozedUntil: undefined,
        resolvedAt: undefined,
        updatedAt,
      },
      action: "reconciled_uncertain",
      result,
    };
  }

  const quote = result.newAnchorQuote?.trim() || input.issue.anchor.quote;
  const quoteStart = input.currentBlock?.text.indexOf(quote) ?? -1;
  const hasValidAnchor = Boolean(input.currentBlock && quoteStart >= 0);
  const context = hasValidAnchor
    ? surroundingContext(
        input.currentBlock!.text,
        quoteStart,
        quoteStart + quote.length,
      )
    : undefined;
  const stillSnoozed = Boolean(
    input.issue.status === "snoozed" &&
    input.issue.snoozedUntil &&
    new Date(input.issue.snoozedUntil).getTime() > input.now.getTime(),
  );
  return {
    issue: {
      ...input.issue,
      status: stillSnoozed ? "snoozed" : "open",
      anchor: hasValidAnchor
        ? {
            ...input.issue.anchor,
            nodeId: input.currentBlock!.nodeId,
            quote,
            quoteStart,
            quoteEnd: quoteStart + quote.length,
            leftContext: context!.left,
            rightContext: context!.right,
            sourceDocumentVersion: input.documentVersion,
            detached: false,
          }
        : input.issue.anchor,
      resolvedAt: undefined,
      updatedAt,
    },
    action: "reconciled_persists",
    result,
  };
}
