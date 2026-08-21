import { createHash, randomUUID } from "node:crypto";

import {
  coreQuestion,
  normalizeIssueText,
  tokenJaccard,
  type IssueRecord,
} from "@openloop/core";
import {
  IssueAnchorSchema,
  IssueRecordSchema,
  type DocumentRecord,
  type IssueCandidateSchema,
  type TextBlockSnapshot,
} from "@openloop/shared";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import type { Database } from "./db/client.js";
import { issues } from "./db/schema.js";
import {
  appendEvent,
  documentBlocks,
  issueValues,
  listIssues,
  type DocumentBlock,
} from "./issues.js";

type IssueCandidate = z.infer<typeof IssueCandidateSchema>;

export interface PersistedCriticIssue {
  kind: "created" | "updated";
  issue: IssueRecord;
  needsReconciliation: boolean;
  resurfaceTrigger?: "severity_escalated";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keywordOverlap(left: string[], right: string[]): number {
  const normalizedLeft = new Set(left.map(normalizeIssueText).filter(Boolean));
  const normalizedRight = new Set(
    right.map(normalizeIssueText).filter(Boolean),
  );
  if (normalizedLeft.size === 0 || normalizedRight.size === 0) return 0;
  const intersection = [...normalizedLeft].filter((keyword) =>
    normalizedRight.has(keyword),
  ).length;
  return intersection / Math.max(normalizedLeft.size, normalizedRight.size);
}

function sameHeading(
  blocks: DocumentBlock[],
  leftNodeId: string,
  rightPath: string[],
): boolean {
  const left = blocks.find((block) => block.nodeId === leftNodeId);
  return Boolean(
    left && left.headingPath.join("\u0000") === rightPath.join("\u0000"),
  );
}

function findDuplicate(
  current: IssueRecord[],
  candidate: IssueCandidate,
  block: TextBlockSnapshot,
  blocks: DocumentBlock[],
  dedupeKey: string,
): IssueRecord | undefined {
  const eligible = current.filter((issue) =>
    ["open", "snoozed", "needs_review", "resolved"].includes(issue.status),
  );
  return (
    eligible.find((issue) => issue.dedupeKey === dedupeKey) ??
    eligible.find(
      (issue) =>
        issue.type === candidate.type &&
        issue.anchor.nodeId === block.nodeId &&
        tokenJaccard(issue.anchor.quote, candidate.anchorQuote) >= 0.72,
    ) ??
    eligible.find(
      (issue) =>
        issue.type === candidate.type &&
        sameHeading(blocks, issue.anchor.nodeId, block.headingPath) &&
        keywordOverlap(issue.keywords, candidate.keywords) >= 0.7,
    )
  );
}

function updateDuplicate(
  database: Database,
  duplicate: IssueRecord,
  candidate: IssueCandidate,
):
  | {
      issue: IssueRecord;
      needsReconciliation: boolean;
      resurfaceTrigger?: "severity_escalated";
    }
  | undefined {
  const severityEscalated = candidate.severity > duplicate.severity;
  const interruptEscalated =
    candidate.interruptWorthiness - duplicate.interruptWorthiness >= 0.15;
  const confidence = Math.max(duplicate.confidence, candidate.confidence);
  const wordingChanged =
    normalizeIssueText(candidate.anchorQuote) !==
      normalizeIssueText(duplicate.anchor.quote) ||
    coreQuestion(candidate.question) !== coreQuestion(duplicate.question);
  if (
    !severityEscalated &&
    !interruptEscalated &&
    confidence === duplicate.confidence &&
    !wordingChanged
  ) {
    return;
  }
  const updated: IssueRecord = {
    ...duplicate,
    severity: Math.max(
      duplicate.severity,
      candidate.severity,
    ) as IssueRecord["severity"],
    confidence,
    interruptWorthiness: Math.max(
      duplicate.interruptWorthiness,
      candidate.interruptWorthiness,
    ),
    resurfaceTriggers:
      severityEscalated || interruptEscalated
        ? [
            ...new Set([
              ...duplicate.resurfaceTriggers,
              "severity_escalated" as const,
            ]),
          ]
        : duplicate.resurfaceTriggers,
    status:
      severityEscalated && duplicate.status === "resolved"
        ? "open"
        : duplicate.status,
    resolvedAt:
      severityEscalated && duplicate.status === "resolved"
        ? undefined
        : duplicate.resolvedAt,
    updatedAt: new Date().toISOString(),
  };
  database.orm
    .update(issues)
    .set(issueValues(updated))
    .where(eq(issues.id, updated.id))
    .run();
  return {
    issue: updated,
    needsReconciliation: wordingChanged,
    ...(severityEscalated || interruptEscalated
      ? { resurfaceTrigger: "severity_escalated" as const }
      : {}),
  };
}

function createIssue(input: {
  candidate: IssueCandidate;
  document: DocumentRecord;
  documentVersion: number;
  block: TextBlockSnapshot;
  canonicalBlock: DocumentBlock;
  dedupeKey: string;
  shown: boolean;
}): IssueRecord {
  const quoteStart = input.canonicalBlock.text.indexOf(
    input.candidate.anchorQuote,
  );
  const quoteEnd = quoteStart + input.candidate.anchorQuote.length;
  const now = new Date().toISOString();
  return IssueRecordSchema.parse({
    id: randomUUID(),
    documentId: input.document.id,
    type: input.candidate.type,
    status: "open",
    question: input.candidate.question,
    rationale: input.candidate.rationale,
    ...(input.candidate.suggestedRewrite
      ? { suggestedRewrite: input.candidate.suggestedRewrite }
      : {}),
    severity: input.candidate.severity,
    confidence: input.candidate.confidence,
    interruptWorthiness: input.candidate.interruptWorthiness,
    anchor: IssueAnchorSchema.parse({
      nodeId: input.block.nodeId,
      quote: input.candidate.anchorQuote,
      quoteStart,
      quoteEnd,
      leftContext: input.canonicalBlock.text.slice(
        Math.max(0, quoteStart - 80),
        quoteStart,
      ),
      rightContext: input.canonicalBlock.text.slice(quoteEnd, quoteEnd + 80),
      normalizedFingerprint: sha256(
        normalizeIssueText(input.candidate.anchorQuote) +
          normalizeIssueText(
            input.canonicalBlock.text.slice(
              Math.max(0, quoteStart - 80),
              quoteStart,
            ),
          ) +
          normalizeIssueText(
            input.canonicalBlock.text.slice(quoteEnd, quoteEnd + 80),
          ) +
          input.canonicalBlock.headingPath.map(normalizeIssueText).join("/"),
      ),
      sourceDocumentVersion: input.documentVersion,
      detached: false,
    }),
    keywords: input.candidate.keywords,
    resurfaceTriggers: input.candidate.resurfaceTriggers,
    dedupeKey: input.dedupeKey,
    shownCount: input.shown ? 1 : 0,
    silentIgnoreCount: 0,
    ...(input.shown ? { lastShownAt: now } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

function insertIssue(
  database: Database,
  issue: IssueRecord,
  documentVersion: number,
): void {
  const now = new Date(issue.createdAt).getTime();
  database.sqlite.transaction(() => {
    database.orm
      .insert(issues)
      .values({
        id: issue.id,
        documentId: issue.documentId,
        type: issue.type,
        status: issue.status,
        question: issue.question,
        rationale: issue.rationale,
        suggestedRewrite: issue.suggestedRewrite,
        severity: issue.severity,
        confidence: issue.confidence,
        interruptWorthiness: issue.interruptWorthiness,
        anchorJson: JSON.stringify(issue.anchor),
        keywordsJson: JSON.stringify(issue.keywords),
        resurfaceTriggersJson: JSON.stringify(issue.resurfaceTriggers),
        dedupeKey: issue.dedupeKey,
        shownCount: issue.shownCount,
        silentIgnoreCount: issue.silentIgnoreCount,
        lastShownAt: issue.lastShownAt ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (issue.shownCount > 0) {
      appendEvent(database, {
        issue,
        action: "show",
        documentVersion,
        payload: { reason: "new_issue" },
        now,
      });
    }
  })();
}

export function persistCriticCandidates(
  database: Database,
  input: {
    document: DocumentRecord;
    documentVersion: number;
    changedBlocks: TextBlockSnapshot[];
    candidates: IssueCandidate[];
  },
): PersistedCriticIssue[] {
  const current = listIssues(database, input.document.id);
  const blocks = documentBlocks(input.document.contentJson);
  const results: PersistedCriticIssue[] = [];

  for (const candidate of input.candidates) {
    if (
      candidate.confidence < 0.55 ||
      (candidate.interruptWorthiness < 0.55 && candidate.severity < 4)
    ) {
      continue;
    }
    const block = input.changedBlocks.find((changed) =>
      changed.text.includes(candidate.anchorQuote),
    );
    const canonicalBlock = blocks.find(
      (currentBlock) => currentBlock.nodeId === block?.nodeId,
    );
    if (!block || !canonicalBlock?.text.includes(candidate.anchorQuote))
      continue;

    const dedupeKey = sha256(
      candidate.type +
        normalizeIssueText(candidate.anchorQuote) +
        coreQuestion(candidate.question),
    );
    const duplicate = findDuplicate(
      current,
      candidate,
      block,
      blocks,
      dedupeKey,
    );
    if (duplicate) {
      const updated = updateDuplicate(database, duplicate, candidate);
      if (updated) results.push({ kind: "updated", ...updated });
      continue;
    }
    if (
      current.some(
        (issue) =>
          issue.status === "dismissed" &&
          issue.dedupeKey === dedupeKey &&
          issue.anchor.quote === candidate.anchorQuote,
      )
    ) {
      continue;
    }

    const issue = createIssue({
      candidate,
      document: input.document,
      documentVersion: input.documentVersion,
      block,
      canonicalBlock,
      dedupeKey,
      shown: results.length === 0,
    });
    insertIssue(database, issue, input.documentVersion);
    current.push(issue);
    results.push({ kind: "created", issue, needsReconciliation: false });
  }
  return results;
}
