import type { TextBlockSnapshot } from "@openloop/shared";

import {
  normalizeIssueText,
  tokenJaccard,
  type IssueRecord,
} from "./issues.js";

export const GLOBAL_INTERRUPTION_COOLDOWN_MS = 45_000;
export const ISSUE_BASE_COOLDOWN_MS = 120_000;
export const SILENT_IGNORE_EXTRA_COOLDOWN_MS = 180_000;
export const MAX_AUTOMATIC_SHOWS_PER_ISSUE = 3;

export type ResurfaceTrigger = IssueRecord["resurfaceTriggers"][number];

export interface RankedResurfaceIssue {
  issue: IssueRecord;
  score: number;
}

export interface ResurfaceSelectionInput {
  issues: IssueRecord[];
  trigger: ResurfaceTrigger;
  changedBlocks: TextBlockSnapshot[];
  documentVersion: number;
  now: Date;
  lastGlobalShownAt?: string;
  lastShownDocumentVersion?: ReadonlyMap<string, number>;
  preferenceWeights?: Partial<Record<IssueRecord["type"], number>>;
  issueHeadingPaths?: ReadonlyMap<string, string[]>;
  candidateIssueId?: string;
  attention: {
    userIdleMs: number;
    completionVisible: boolean;
    issueCardExpanded: boolean;
  };
}

function includesKeyword(text: string, keyword: string): boolean {
  const normalizedText = ` ${normalizeIssueText(text)} `;
  const normalizedKeyword = normalizeIssueText(keyword);
  return Boolean(
    normalizedKeyword && normalizedText.includes(` ${normalizedKeyword} `),
  );
}

function matchesClaimReuse(
  issue: IssueRecord,
  changedBlocks: TextBlockSnapshot[],
): boolean {
  return changedBlocks.some((block) => {
    if (block.nodeId === issue.anchor.nodeId || !block.text.trim())
      return false;
    const keywordMatches = issue.keywords.filter((keyword) =>
      includesKeyword(block.text, keyword),
    ).length;
    if (keywordMatches < 2) return false;
    const overlap = Math.max(
      tokenJaccard(block.text, issue.anchor.quote),
      tokenJaccard(block.text, issue.question),
    );
    return overlap >= 0.35;
  });
}

function sameHeading(left: string[], right: string[]): boolean {
  return left.join("\u0000") === right.join("\u0000");
}

function matchesSectionEnd(
  issue: IssueRecord,
  changedBlocks: TextBlockSnapshot[],
  issueHeadingPaths: ReadonlyMap<string, string[]> | undefined,
): boolean {
  const issuePath = issueHeadingPaths?.get(issue.id);
  if (!issuePath) return false;
  return changedBlocks.some((block) => {
    if (block.nodeType === "heading" && block.text.trim()) {
      return !sameHeading(issuePath, block.headingPath);
    }
    return (
      !block.text.trim() &&
      block.previousNodeText === "" &&
      sameHeading(issuePath, block.headingPath)
    );
  });
}

function matchesTrigger(
  issue: IssueRecord,
  input: ResurfaceSelectionInput,
): boolean {
  if (input.trigger === "manual_review" || input.trigger === "before_export") {
    return true;
  }
  if (input.trigger === "severity_escalated") {
    return issue.id === input.candidateIssueId;
  }
  if (input.trigger === "claim_reused") {
    return matchesClaimReuse(issue, input.changedBlocks);
  }
  return matchesSectionEnd(issue, input.changedBlocks, input.issueHeadingPaths);
}

function triggerBonus(trigger: ResurfaceTrigger): number {
  return {
    severity_escalated: 2,
    claim_reused: 1.5,
    section_end: 1,
    manual_review: 0.5,
    before_export: 0,
  }[trigger];
}

function recentPenalty(issue: IssueRecord, now: Date): number {
  if (!issue.lastShownAt) return 0;
  const age = now.getTime() - new Date(issue.lastShownAt).getTime();
  if (age < 5 * 60_000) return 3;
  if (age < 30 * 60_000) return 1.5;
  return 0;
}

function isEligible(
  issue: IssueRecord,
  input: ResurfaceSelectionInput,
): boolean {
  if (issue.status !== "open" && issue.status !== "snoozed") return false;
  if (issue.anchor.detached) return false;
  if (
    input.trigger !== "manual_review" &&
    input.trigger !== "before_export" &&
    input.trigger !== "severity_escalated" &&
    issue.shownCount >= MAX_AUTOMATIC_SHOWS_PER_ISSUE
  ) {
    return false;
  }
  if (
    input.trigger !== "manual_review" &&
    input.trigger !== "before_export" &&
    !issue.resurfaceTriggers.includes(input.trigger)
  ) {
    return false;
  }
  if (
    input.trigger === "before_export" &&
    issue.severity < 4 &&
    !issue.resurfaceTriggers.includes("before_export")
  ) {
    return false;
  }
  if (!matchesTrigger(issue, input)) return false;

  const manual = input.trigger === "manual_review";
  if (!manual) {
    if (
      input.attention.userIdleMs < 1_200 ||
      input.attention.completionVisible ||
      input.attention.issueCardExpanded
    ) {
      return false;
    }
    if (
      input.lastShownDocumentVersion?.get(issue.id) === input.documentVersion
    ) {
      return false;
    }
    const now = input.now.getTime();
    if (
      input.lastGlobalShownAt &&
      now - new Date(input.lastGlobalShownAt).getTime() <
        GLOBAL_INTERRUPTION_COOLDOWN_MS
    ) {
      return false;
    }
    if (issue.lastShownAt) {
      const cooldown =
        ISSUE_BASE_COOLDOWN_MS +
        (issue.silentIgnoreCount > 0 ? SILENT_IGNORE_EXTRA_COOLDOWN_MS : 0);
      if (now - new Date(issue.lastShownAt).getTime() < cooldown) return false;
    }
    if (
      issue.status === "snoozed" &&
      issue.snoozedUntil &&
      new Date(issue.snoozedUntil).getTime() > now
    ) {
      return false;
    }
  }
  return true;
}

export function rankResurfaceIssues(
  input: ResurfaceSelectionInput,
): RankedResurfaceIssue[] {
  return input.issues
    .filter((issue) => isEligible(issue, input))
    .map((issue) => {
      const weight = input.preferenceWeights?.[issue.type] ?? 1;
      return {
        issue,
        score:
          issue.severity * 2 +
          issue.confidence * 1.5 +
          issue.interruptWorthiness * 2 +
          triggerBonus(input.trigger) +
          (weight - 1) * 2 -
          issue.shownCount * 1.25 -
          issue.silentIgnoreCount * 0.75 -
          recentPenalty(issue, input.now),
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.issue.severity - left.issue.severity ||
        new Date(left.issue.createdAt).getTime() -
          new Date(right.issue.createdAt).getTime(),
    );
}

export function selectResurfaceIssue(
  input: ResurfaceSelectionInput,
): RankedResurfaceIssue | undefined {
  return rankResurfaceIssues(input)[0];
}
