import { createHash } from "node:crypto";

import {
  applyReconciliationResult,
  normalizeIssueText,
  remapIssueAnchor,
  type IssueRecord,
} from "@openloop/core";
import type {
  DocumentRecord,
  EditorChangeBatch,
  ReconcileResultSchema,
  TextBlockSnapshot,
} from "@openloop/shared";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import type { Database } from "./db/client.js";
import { issues } from "./db/schema.js";
import {
  appendEvent,
  documentBlocks,
  getIssue,
  issueValues,
  listIssues,
} from "./issues.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(issue: IssueRecord, headingPath: string[]): string {
  return sha256(
    normalizeIssueText(issue.anchor.quote) +
      normalizeIssueText(issue.anchor.leftContext) +
      normalizeIssueText(issue.anchor.rightContext) +
      headingPath.map(normalizeIssueText).join("/"),
  );
}

function snapshots(document: DocumentRecord): TextBlockSnapshot[] {
  return documentBlocks(document.contentJson).map((block, index, blocks) => ({
    ...block,
    previousNodeText: blocks[index - 1]?.text,
    nextNodeText: blocks[index + 1]?.text,
  }));
}

export function remapImpactedIssues(
  database: Database,
  input: {
    previousDocument: DocumentRecord;
    currentDocument: DocumentRecord;
    changeBatch: EditorChangeBatch;
    now?: Date;
  },
): { impactedIssueIds: string[]; updatedIssues: IssueRecord[] } {
  const affectedNodeIds = new Set([
    ...input.changeBatch.changedBlocks.map((block) => block.nodeId),
    ...input.changeBatch.removedNodeIds,
    ...Object.keys(input.changeBatch.mergedNodeMap),
  ]);
  if (affectedNodeIds.size === 0) {
    return { impactedIssueIds: [], updatedIssues: [] };
  }

  const previousBlocks = snapshots(input.previousDocument);
  const currentBlocks = snapshots(input.currentDocument);
  const now = input.now ?? new Date();
  const impactedIssueIds: string[] = [];
  const updatedIssues: IssueRecord[] = [];

  for (const issue of listIssues(database, input.currentDocument.id).filter(
    (candidate) =>
      ["open", "snoozed", "needs_review"].includes(candidate.status) &&
      affectedNodeIds.has(candidate.anchor.nodeId),
  )) {
    const remapped = remapIssueAnchor({
      issue,
      previousBlocks,
      currentBlocks,
      mergedNodeMap: input.changeBatch.mergedNodeMap,
      documentVersion: input.currentDocument.version,
      now,
    });
    const updated = {
      ...remapped.issue,
      anchor: {
        ...remapped.issue.anchor,
        normalizedFingerprint:
          remapped.kind === "detached"
            ? issue.anchor.normalizedFingerprint
            : fingerprint(remapped.issue, remapped.headingPath ?? []),
      },
    };
    database.orm
      .update(issues)
      .set(issueValues(updated))
      .where(eq(issues.id, updated.id))
      .run();
    if (remapped.kind === "remapped") {
      appendEvent(database, {
        issue: updated,
        action: "anchor_remapped",
        documentVersion: input.currentDocument.version,
        payload: {
          nodeId: updated.anchor.nodeId,
          quote: updated.anchor.quote,
          score: remapped.score ?? 0,
        },
        now: now.getTime(),
      });
    }
    if (remapped.needsReconciliation) impactedIssueIds.push(updated.id);
    updatedIssues.push(updated);
  }

  return { impactedIssueIds, updatedIssues };
}

export function reconciliationContext(
  document: DocumentRecord,
  issue: IssueRecord,
  changedBlocks: TextBlockSnapshot[] = [],
): { currentBlock?: TextBlockSnapshot; nearbyBlocks: TextBlockSnapshot[] } {
  const blocks = snapshots(document);
  const index = blocks.findIndex(
    (block) => block.nodeId === issue.anchor.nodeId,
  );
  if (index < 0) {
    const changedIds = new Set(changedBlocks.map((block) => block.nodeId));
    const related = blocks.filter((block, blockIndex) => {
      if (changedIds.has(block.nodeId)) return true;
      return blocks
        .slice(Math.max(0, blockIndex - 2), blockIndex + 3)
        .some((candidate) => changedIds.has(candidate.nodeId));
    });
    return {
      nearbyBlocks: (related.length > 0 ? related : blocks).slice(0, 5),
    };
  }
  return {
    currentBlock: blocks[index],
    nearbyBlocks: blocks.slice(Math.max(0, index - 2), index + 3),
  };
}

export function persistReconciliationResult(
  database: Database,
  input: {
    document: DocumentRecord;
    issueId: string;
    result: z.infer<typeof ReconcileResultSchema>;
    context?: {
      currentBlock?: TextBlockSnapshot;
      nearbyBlocks: TextBlockSnapshot[];
    };
    now?: Date;
  },
): IssueRecord {
  const issue = getIssue(database, input.issueId);
  const context = input.context ?? reconciliationContext(input.document, issue);
  const proposedQuote = input.result.newAnchorQuote?.trim();
  const resultBlock = proposedQuote
    ? [context.currentBlock, ...context.nearbyBlocks].find((block) =>
        block?.text.includes(proposedQuote),
      )
    : context.currentBlock;
  const now = input.now ?? new Date();
  const transitioned = applyReconciliationResult({
    issue,
    result: input.result,
    currentBlock: resultBlock,
    documentVersion: input.document.version,
    now,
  });
  const headingPath = resultBlock?.headingPath ?? [];
  const updated = {
    ...transitioned.issue,
    anchor: {
      ...transitioned.issue.anchor,
      normalizedFingerprint: resultBlock
        ? fingerprint(transitioned.issue, headingPath)
        : transitioned.issue.anchor.normalizedFingerprint,
    },
  };

  database.sqlite.transaction(() => {
    database.orm
      .update(issues)
      .set(issueValues(updated))
      .where(eq(issues.id, updated.id))
      .run();
    appendEvent(database, {
      issue: updated,
      action: transitioned.action,
      documentVersion: input.document.version,
      payload: {
        reason: transitioned.result.reason,
        confidence: transitioned.result.confidence,
        ...(transitioned.result.newAnchorQuote
          ? { newAnchorQuote: transitioned.result.newAnchorQuote }
          : {}),
      },
      now: now.getTime(),
    });
  })();
  return updated;
}
