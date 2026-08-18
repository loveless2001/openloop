import {
  InvalidIssueTransitionError,
  transitionIssue,
  type IssueDomainEvent,
  type IssueRecord,
} from "@openloop/core";
import type { EditorOperation, IssueActionRequest } from "@openloop/shared";
import { eq } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { issues } from "./db/schema.js";
import { getDocument } from "./documents.js";
import {
  appendEvent,
  documentBlocks,
  getIssue,
  IssueActionConflictError,
  issueValues,
} from "./issues.js";

function actionEvent(input: IssueActionRequest, now: Date): IssueDomainEvent {
  if (input.action === "snooze") {
    return {
      action: "snooze",
      snoozedUntil: new Date(now.getTime() + 120_000),
    };
  }
  return { action: input.action };
}

export function applyIssueAction(
  database: Database,
  issueId: string,
  input: IssueActionRequest,
): { issue: IssueRecord; editorOperation?: EditorOperation } {
  const existing = getIssue(database, issueId);
  const now = new Date();
  let operation: EditorOperation | undefined;

  if (input.action === "apply_rewrite") {
    if (input.expectedAnchorQuote !== existing.anchor.quote) {
      throw new IssueActionConflictError("The expected anchor has changed.");
    }
    const document = getDocument(database, existing.documentId);
    const block = documentBlocks(document.contentJson).find(
      (candidate) => candidate.nodeId === existing.anchor.nodeId,
    );
    const from = block?.text.indexOf(input.expectedAnchorQuote) ?? -1;
    if (from < 0 || !existing.suggestedRewrite) {
      throw new IssueActionConflictError(
        "The anchored text no longer supports this rewrite.",
      );
    }
    operation = {
      nodeId: existing.anchor.nodeId,
      from,
      to: from + input.expectedAnchorQuote.length,
      insertText: existing.suggestedRewrite,
    };
  }

  let transitioned: IssueRecord;
  try {
    transitioned = transitionIssue(
      existing,
      actionEvent(input, now),
      now,
    ).issue;
  } catch (error) {
    if (error instanceof InvalidIssueTransitionError) {
      throw new IssueActionConflictError(error.message);
    }
    throw error;
  }

  database.sqlite.transaction(() => {
    database.orm
      .update(issues)
      .set(issueValues(transitioned))
      .where(eq(issues.id, issueId))
      .run();
    appendEvent(database, {
      issue: transitioned,
      action: input.action,
      documentVersion: input.documentVersion,
      payload: operation ? { editorOperation: operation } : {},
      now: now.getTime(),
    });
  })();

  return {
    issue: transitioned,
    ...(operation ? { editorOperation: operation } : {}),
  };
}
