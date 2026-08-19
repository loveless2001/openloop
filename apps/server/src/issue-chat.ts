import { randomUUID } from "node:crypto";

import {
  IssueChatAttachmentSchema,
  IssueChatMessageSchema,
  IssueChatReplySchema,
  IssueChatThreadSchema,
  type IssueChatAttachment,
  type IssueChatMessage,
  type IssueChatReply,
  type IssueChatSendRequest,
  type IssueChatThread,
} from "@openloop/shared";
import { eq } from "drizzle-orm";

import type { Database } from "./db/client.js";
import { issueChatMessages, issueChatThreads } from "./db/schema.js";
import { getIssue } from "./issues.js";

type ThreadRow = typeof issueChatThreads.$inferSelect;
type MessageRow = typeof issueChatMessages.$inferSelect;

export class IssueChatBusyError extends Error {
  readonly code = "ISSUE_CHAT_BUSY";
}

function toThread(row: ThreadRow): IssueChatThread {
  return IssueChatThreadSchema.parse({
    issueId: row.issueId,
    documentId: row.documentId,
    state: row.state,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  });
}

function toMessage(row: MessageRow): IssueChatMessage {
  return IssueChatMessageSchema.parse({
    id: row.id,
    issueId: row.issueId,
    role: row.role,
    kind: row.kind,
    content: row.content,
    attachments: JSON.parse(row.attachmentsJson),
    createdAt: new Date(row.createdAt).toISOString(),
  });
}

export function ensureIssueChatThread(
  database: Database,
  issueId: string,
  now = Date.now(),
): IssueChatThread {
  const issue = getIssue(database, issueId);
  const existing = database.orm
    .select()
    .from(issueChatThreads)
    .where(eq(issueChatThreads.issueId, issueId))
    .get();
  if (existing) return toThread(existing);
  database.orm
    .insert(issueChatThreads)
    .values({
      issueId,
      documentId: issue.documentId,
      state: "idle",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  return getIssueChatThread(database, issueId);
}

export function getIssueChatThread(
  database: Database,
  issueId: string,
): IssueChatThread {
  const row = database.orm
    .select()
    .from(issueChatThreads)
    .where(eq(issueChatThreads.issueId, issueId))
    .get();
  if (!row) return ensureIssueChatThread(database, issueId);
  return toThread(row);
}

export function listIssueChatMessages(
  database: Database,
  issueId: string,
): IssueChatMessage[] {
  ensureIssueChatThread(database, issueId);
  return database.orm
    .select()
    .from(issueChatMessages)
    .where(eq(issueChatMessages.issueId, issueId))
    .orderBy(issueChatMessages.createdAt)
    .all()
    .map(toMessage);
}

export function getIssueChat(database: Database, issueId: string) {
  return {
    thread: ensureIssueChatThread(database, issueId),
    messages: listIssueChatMessages(database, issueId),
  };
}

export function appendUserIssueChatMessage(
  database: Database,
  issueId: string,
  input: IssueChatSendRequest,
  now = Date.now(),
): { thread: IssueChatThread; message: IssueChatMessage } {
  ensureIssueChatThread(database, issueId, now);
  const attachments: IssueChatAttachment[] = input.attachments.map(
    (attachment) =>
      IssueChatAttachmentSchema.parse({ id: randomUUID(), ...attachment }),
  );
  const message = IssueChatMessageSchema.parse({
    id: randomUUID(),
    issueId,
    role: "user",
    kind: "message",
    content: input.content,
    attachments,
    createdAt: new Date(now).toISOString(),
  });
  const transaction = database.sqlite.transaction(() => {
    const currentThread = database.orm
      .select()
      .from(issueChatThreads)
      .where(eq(issueChatThreads.issueId, issueId))
      .get();
    if (currentThread?.state === "waiting_on_critic") {
      throw new IssueChatBusyError(
        "Wait for the critic's current reply before sending another message.",
      );
    }
    database.orm
      .insert(issueChatMessages)
      .values({
        id: message.id,
        issueId,
        role: message.role,
        kind: message.kind,
        content: message.content,
        attachmentsJson: JSON.stringify(message.attachments),
        createdAt: now,
      })
      .run();
    database.orm
      .update(issueChatThreads)
      .set({ state: "waiting_on_critic", updatedAt: now })
      .where(eq(issueChatThreads.issueId, issueId))
      .run();
  });
  transaction();
  return { thread: getIssueChatThread(database, issueId), message };
}

export function appendCriticIssueChatMessage(
  database: Database,
  issueId: string,
  input: IssueChatReply,
  now = Date.now(),
): { thread: IssueChatThread; message: IssueChatMessage } {
  ensureIssueChatThread(database, issueId, now);
  const reply = IssueChatReplySchema.parse(input);
  const message = IssueChatMessageSchema.parse({
    id: randomUUID(),
    issueId,
    role: "critic",
    kind: reply.kind,
    content: reply.content,
    attachments: [],
    createdAt: new Date(now).toISOString(),
  });
  const transaction = database.sqlite.transaction(() => {
    database.orm
      .insert(issueChatMessages)
      .values({
        id: message.id,
        issueId,
        role: message.role,
        kind: message.kind,
        content: message.content,
        attachmentsJson: "[]",
        createdAt: now,
      })
      .run();
    database.orm
      .update(issueChatThreads)
      .set({ state: "waiting_on_user", updatedAt: now })
      .where(eq(issueChatThreads.issueId, issueId))
      .run();
  });
  transaction();
  return { thread: getIssueChatThread(database, issueId), message };
}

export function markIssueChatError(
  database: Database,
  issueId: string,
  now = Date.now(),
): IssueChatThread {
  ensureIssueChatThread(database, issueId, now);
  database.orm
    .update(issueChatThreads)
    .set({ state: "error", updatedAt: now })
    .where(eq(issueChatThreads.issueId, issueId))
    .run();
  return getIssueChatThread(database, issueId);
}
