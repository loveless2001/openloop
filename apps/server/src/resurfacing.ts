import { selectResurfaceIssue, type IssueRecord } from "@openloop/core";
import type { ResurfaceRequest } from "@openloop/shared";
import { eq } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { issues } from "./db/schema.js";
import {
  appendEvent,
  documentBlocks,
  issueValues,
  listIssues,
} from "./issues.js";
import { getDocument, DocumentVersionConflictError } from "./documents.js";
import { preferenceWeightMap } from "./preferences.js";

interface ShowEventRow {
  issueId: string;
  documentVersion: number;
  createdAt: number;
}

export function resurfaceIssue(
  database: Database,
  documentId: string,
  input: ResurfaceRequest,
  now = new Date(),
): IssueRecord | undefined {
  const document = getDocument(database, documentId);
  if (document.version !== input.documentVersion) {
    throw new DocumentVersionConflictError(document.version);
  }
  const currentIssues = listIssues(database, documentId);
  const blocks = documentBlocks(document.contentJson);
  const pathByNode = new Map(
    blocks.map((block) => [block.nodeId, block.headingPath]),
  );
  const issueHeadingPaths = new Map(
    currentIssues.map((issue) => [
      issue.id,
      pathByNode.get(issue.anchor.nodeId) ?? [],
    ]),
  );
  const showEvents = database.sqlite
    .prepare(
      "select issue_id as issueId, document_version as documentVersion, created_at as createdAt from issue_events where document_id = ? and action = 'show' order by created_at desc",
    )
    .all(documentId) as ShowEventRow[];
  const lastShownDocumentVersion = new Map<string, number>();
  for (const event of showEvents) {
    if (!lastShownDocumentVersion.has(event.issueId)) {
      lastShownDocumentVersion.set(event.issueId, event.documentVersion);
    }
  }
  const selected = selectResurfaceIssue({
    issues: currentIssues,
    trigger: input.trigger,
    changedBlocks: input.changedBlocks,
    documentVersion: input.documentVersion,
    now,
    ...(showEvents[0]
      ? { lastGlobalShownAt: new Date(showEvents[0].createdAt).toISOString() }
      : {}),
    lastShownDocumentVersion,
    preferenceWeights: preferenceWeightMap(database),
    issueHeadingPaths,
    attention: input.attention,
    ...(input.candidateIssueId
      ? { candidateIssueId: input.candidateIssueId }
      : {}),
  });
  if (!selected) return;

  const updated: IssueRecord = {
    ...selected.issue,
    status: "open",
    shownCount: selected.issue.shownCount + 1,
    lastShownAt: now.toISOString(),
    snoozedUntil: undefined,
    updatedAt: now.toISOString(),
  };
  database.sqlite.transaction(() => {
    database.orm
      .update(issues)
      .set(issueValues(updated))
      .where(eq(issues.id, updated.id))
      .run();
    appendEvent(database, {
      issue: updated,
      action: "show",
      documentVersion: document.version,
      payload: {
        reason: input.trigger,
        resurfaced: true,
        score: selected.score,
      },
      now: now.getTime(),
    });
  })();
  return updated;
}
