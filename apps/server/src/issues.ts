import { randomUUID } from "node:crypto";

import type { IssueRecord } from "@openloop/core";
import {
  IssueAnchorSchema,
  IssueEventRecordSchema,
  IssueRecordSchema,
  type IssueEventRecord,
  type JsonValue,
  type TextBlockSnapshot,
} from "@openloop/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { issueEvents, issues } from "./db/schema.js";

type IssueRow = typeof issues.$inferSelect;

export class IssueNotFoundError extends Error {
  readonly code = "ISSUE_NOT_FOUND";
}

export class IssueActionConflictError extends Error {
  readonly code = "ISSUE_ACTION_CONFLICT";
}

export interface DocumentBlock {
  nodeId: string;
  nodeType: TextBlockSnapshot["nodeType"];
  text: string;
  headingPath: string[];
}

function optionalDate(value: number | null): string | undefined {
  return value === null ? undefined : new Date(value).toISOString();
}

function toIssueRecord(row: IssueRow): IssueRecord {
  return IssueRecordSchema.parse({
    id: row.id,
    documentId: row.documentId,
    type: row.type,
    status: row.status,
    question: row.question,
    rationale: row.rationale,
    ...(row.suggestedRewrite === null
      ? {}
      : { suggestedRewrite: row.suggestedRewrite }),
    severity: row.severity,
    confidence: row.confidence,
    interruptWorthiness: row.interruptWorthiness,
    anchor: IssueAnchorSchema.parse(JSON.parse(row.anchorJson)),
    keywords: JSON.parse(row.keywordsJson),
    resurfaceTriggers: JSON.parse(row.resurfaceTriggersJson),
    dedupeKey: row.dedupeKey,
    shownCount: row.shownCount,
    silentIgnoreCount: row.silentIgnoreCount,
    ...(optionalDate(row.lastShownAt)
      ? { lastShownAt: optionalDate(row.lastShownAt) }
      : {}),
    ...(optionalDate(row.snoozedUntil)
      ? { snoozedUntil: optionalDate(row.snoozedUntil) }
      : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    ...(optionalDate(row.resolvedAt)
      ? { resolvedAt: optionalDate(row.resolvedAt) }
      : {}),
  });
}

export function issueValues(
  issue: IssueRecord,
): Partial<typeof issues.$inferInsert> {
  return {
    status: issue.status,
    severity: issue.severity,
    confidence: issue.confidence,
    resurfaceTriggersJson: JSON.stringify(issue.resurfaceTriggers),
    anchorJson: JSON.stringify(issue.anchor),
    shownCount: issue.shownCount,
    silentIgnoreCount: issue.silentIgnoreCount,
    lastShownAt: issue.lastShownAt
      ? new Date(issue.lastShownAt).getTime()
      : null,
    snoozedUntil: issue.snoozedUntil
      ? new Date(issue.snoozedUntil).getTime()
      : null,
    updatedAt: new Date(issue.updatedAt).getTime(),
    resolvedAt: issue.resolvedAt ? new Date(issue.resolvedAt).getTime() : null,
  };
}

function textContent(value: JsonValue): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const own = typeof value.text === "string" ? value.text : "";
  const children = Array.isArray(value.content) ? value.content : [];
  return own + children.map(textContent).join("");
}

export function documentBlocks(
  content: Record<string, JsonValue>,
): DocumentBlock[] {
  const result: DocumentBlock[] = [];
  let headings: string[] = [];
  function visit(values: JsonValue[]): void {
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const type = typeof value.type === "string" ? value.type : "";
      const attrs =
        value.attrs &&
        typeof value.attrs === "object" &&
        !Array.isArray(value.attrs)
          ? value.attrs
          : {};
      const text = textContent(value);
      if (type === "heading") {
        const level = typeof attrs.level === "number" ? attrs.level : 1;
        headings = [...headings.slice(0, level - 1), text];
      }
      if (
        ["paragraph", "heading", "blockquote"].includes(type) &&
        typeof attrs.nodeId === "string"
      ) {
        result.push({
          nodeId: attrs.nodeId,
          nodeType: type as TextBlockSnapshot["nodeType"],
          text,
          headingPath: [...headings],
        });
      }
      if (Array.isArray(value.content)) visit(value.content);
    }
  }
  visit(Array.isArray(content.content) ? content.content : []);
  return result;
}

export function appendEvent(
  database: Database,
  input: {
    issue: IssueRecord;
    action: IssueEventRecord["action"];
    documentVersion: number;
    payload?: Record<string, JsonValue>;
    now: number;
  },
): IssueEventRecord {
  const event = IssueEventRecordSchema.parse({
    id: randomUUID(),
    issueId: input.issue.id,
    documentId: input.issue.documentId,
    action: input.action,
    documentVersion: input.documentVersion,
    payload: input.payload ?? {},
    createdAt: new Date(input.now).toISOString(),
  });
  database.orm
    .insert(issueEvents)
    .values({
      id: event.id,
      issueId: event.issueId,
      documentId: event.documentId,
      action: event.action,
      documentVersion: event.documentVersion,
      payloadJson: JSON.stringify(event.payload),
      createdAt: input.now,
    })
    .run();
  return event;
}

export function listIssues(
  database: Database,
  documentId: string,
  statuses?: IssueRecord["status"][],
): IssueRecord[] {
  const where = statuses?.length
    ? and(eq(issues.documentId, documentId), inArray(issues.status, statuses))
    : eq(issues.documentId, documentId);
  return database.orm
    .select()
    .from(issues)
    .where(where)
    .orderBy(desc(issues.updatedAt))
    .all()
    .map(toIssueRecord);
}

export function getIssue(database: Database, issueId: string): IssueRecord {
  const row = database.orm
    .select()
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();
  if (!row) throw new IssueNotFoundError("Issue not found.");
  return toIssueRecord(row);
}

export function listIssueEvents(
  database: Database,
  issueId: string,
): IssueEventRecord[] {
  getIssue(database, issueId);
  return database.orm
    .select()
    .from(issueEvents)
    .where(eq(issueEvents.issueId, issueId))
    .orderBy(issueEvents.createdAt)
    .all()
    .map((row) =>
      IssueEventRecordSchema.parse({
        id: row.id,
        issueId: row.issueId,
        documentId: row.documentId,
        action: row.action,
        documentVersion: row.documentVersion,
        payload: JSON.parse(row.payloadJson),
        createdAt: new Date(row.createdAt).toISOString(),
      }),
    );
}

export { applyIssueAction } from "./issue-actions.js";
export {
  persistCriticCandidates,
  type PersistedCriticIssue,
} from "./issue-candidates.js";
