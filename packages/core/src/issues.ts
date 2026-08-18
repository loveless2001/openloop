import type { z } from "zod";

import type {
  IssueStatus,
  IssueType,
  ResurfaceTrigger,
} from "@openloop/shared";

export interface IssueAnchor {
  nodeId: string;
  quote: string;
  quoteStart?: number;
  quoteEnd?: number;
  leftContext: string;
  rightContext: string;
  normalizedFingerprint: string;
  sourceDocumentVersion: number;
  detached: boolean;
}

export interface IssueRecord {
  id: string;
  documentId: string;
  type: z.infer<typeof IssueType>;
  status: z.infer<typeof IssueStatus>;
  question: string;
  rationale: string;
  suggestedRewrite?: string;
  severity: 1 | 2 | 3 | 4 | 5;
  confidence: number;
  interruptWorthiness: number;
  anchor: IssueAnchor;
  keywords: string[];
  resurfaceTriggers: Array<z.infer<typeof ResurfaceTrigger>>;
  dedupeKey: string;
  shownCount: number;
  silentIgnoreCount: number;
  lastShownAt?: string;
  snoozedUntil?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export type IssueDomainEvent =
  | { action: "apply_rewrite" }
  | { action: "dismiss" }
  | { action: "reopen" }
  | { action: "resolve" }
  | { action: "snooze"; snoozedUntil: Date };

export interface IssueTransitionResult {
  issue: IssueRecord;
  action: IssueDomainEvent["action"];
}

export class InvalidIssueTransitionError extends Error {
  readonly code = "INVALID_ISSUE_TRANSITION";
}

const NON_TERMINAL_STATUSES = new Set<IssueRecord["status"]>([
  "open",
  "snoozed",
  "needs_review",
]);

export function normalizeIssueText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function coreQuestion(value: string): string {
  return normalizeIssueText(value).replace(
    /^(?:are you sure|do you mean|how do you)\s+/,
    "",
  );
}

export function tokenJaccard(left: string, right: string): number {
  const leftTokens = new Set(
    normalizeIssueText(left).split(" ").filter(Boolean),
  );
  const rightTokens = new Set(
    normalizeIssueText(right).split(" ").filter(Boolean),
  );
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

export function transitionIssue(
  issue: IssueRecord,
  event: IssueDomainEvent,
  now: Date,
): IssueTransitionResult {
  const updatedAt = now.toISOString();

  if (event.action === "apply_rewrite") {
    if (!NON_TERMINAL_STATUSES.has(issue.status) || !issue.suggestedRewrite) {
      throw new InvalidIssueTransitionError(
        "A rewrite can only be applied to an active issue with a suggestion.",
      );
    }
    return { issue: { ...issue, updatedAt }, action: event.action };
  }

  if (event.action === "reopen") {
    if (issue.status !== "resolved" && issue.status !== "dismissed") {
      throw new InvalidIssueTransitionError(
        "Only resolved or dismissed issues can be reopened.",
      );
    }
    return {
      issue: {
        ...issue,
        status: "open",
        resolvedAt: undefined,
        snoozedUntil: undefined,
        updatedAt,
      },
      action: event.action,
    };
  }

  if (!NON_TERMINAL_STATUSES.has(issue.status)) {
    throw new InvalidIssueTransitionError(
      `Issue status ${issue.status} does not allow ${event.action}.`,
    );
  }

  if (event.action === "snooze") {
    return {
      issue: {
        ...issue,
        status: "snoozed",
        snoozedUntil: event.snoozedUntil.toISOString(),
        updatedAt,
      },
      action: event.action,
    };
  }
  if (event.action === "dismiss") {
    return {
      issue: {
        ...issue,
        status: "dismissed",
        snoozedUntil: undefined,
        updatedAt,
      },
      action: event.action,
    };
  }

  return {
    issue: {
      ...issue,
      status: "resolved",
      resolvedAt: updatedAt,
      snoozedUntil: undefined,
      updatedAt,
    },
    action: event.action,
  };
}
