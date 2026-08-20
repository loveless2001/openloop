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
  let best: AnchorMatch | undefined;
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
      if (!best || score > best.score) {
        best = {
          block,
          score,
          quote: candidate.quote,
          quoteStart: candidate.start,
          quoteEnd: candidate.end,
        };
      }
    }
  }
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
  block: TextBlockSnapshot,
): AnchorMatch | undefined {
  const start = block.text.indexOf(issue.anchor.quote);
  if (start < 0) return;
  return {
    block,
    quote: issue.anchor.quote,
    quoteStart: start,
    quoteEnd: start + issue.anchor.quote.length,
    score: 1,
  };
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
  const exact = sameNode ? exactMatch(input.issue, sameNode) : undefined;
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
  const neighborBlocks = input.currentBlocks.filter(
    (block, index) =>
      previousIndex >= 0 &&
      Math.abs(index - previousIndex) <= 2 &&
      sameHeading(originalHeading, block.headingPath),
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
