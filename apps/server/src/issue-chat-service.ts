import { createHash } from "node:crypto";

import type { IssueChatSendRequest } from "@openloop/shared";

import type { CriticAgentController } from "./critic-agent-supervisor.js";
import type { CriticCliCoordinator } from "./critic-cli-coordinator.js";
import type { CriticEventBroker } from "./critic-events.js";
import type { Database } from "./db/client.js";
import { getDocument } from "./documents.js";
import type { IssueChatAgentBroker } from "./issue-chat-agent-broker.js";
import {
  appendCriticIssueChatMessage,
  getIssueChat,
  markIssueChatError,
} from "./issue-chat.js";
import { getIssue } from "./issues.js";
import { createModelRun, finishModelRun } from "./model-runs.js";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const MAX_CHAT_HISTORY_MESSAGES = 20;
const MAX_CHAT_HISTORY_CHARACTERS = 120_000;

export function boundedIssueChatMessages(
  messages: ReturnType<typeof getIssueChat>["messages"],
) {
  const selected = [] as typeof messages;
  let characters = 0;
  for (const message of messages.slice(-MAX_CHAT_HISTORY_MESSAGES).reverse()) {
    const messageCharacters =
      message.content.length +
      message.attachments.reduce(
        (total, attachment) => total + attachment.text.length,
        0,
      );
    if (
      selected.length > 0 &&
      characters + messageCharacters > MAX_CHAT_HISTORY_CHARACTERS
    ) {
      break;
    }
    selected.push(message);
    characters += messageCharacters;
  }
  return selected.reverse();
}

export function processIssueChatTurn(input: {
  database: Database;
  broker: IssueChatAgentBroker;
  coordinator: CriticCliCoordinator;
  controller: CriticAgentController;
  events: CriticEventBroker;
  issueId: string;
  request: IssueChatSendRequest;
  provider: string;
  model: string;
}): void {
  void input.coordinator
    .runIssueTurn(input.issueId, async () => {
      const issue = getIssue(input.database, input.issueId);
      const document = getDocument(input.database, issue.documentId);
      if (document.version !== input.request.documentVersion) {
        throw new Error("The document changed before the chat turn started.");
      }
      const messages = boundedIssueChatMessages(
        getIssueChat(input.database, input.issueId).messages,
      );
      const runId = createModelRun(input.database, {
        requestId: input.request.requestId,
        documentId: issue.documentId,
        kind: "critic_chat",
        provider: input.provider,
        model: input.model,
        inputHash: hash(
          JSON.stringify({
            issueId: issue.id,
            documentVersion: document.version,
            messageIds: messages.map((message) => message.id),
          }),
        ),
      });
      const startedAt = performance.now();
      const job = input.broker.enqueue({
        requestId: input.request.requestId,
        documentTitle: document.title,
        documentVersion: document.version,
        issue: {
          id: issue.id,
          type: issue.type,
          status: issue.status,
          question: issue.question,
          rationale: issue.rationale,
          ...(issue.suggestedRewrite
            ? { suggestedRewrite: issue.suggestedRewrite }
            : {}),
          severity: issue.severity,
          anchor: issue.anchor,
        },
        messages,
      });
      try {
        if (!input.controller.wake) {
          throw new Error("The managed critic controller cannot wake a CLI.");
        }
        await input.controller.wake(
          "Call openloop_issue_chat_next now. Answer only that issue-chat turn using its bounded thread and attached text. If the user's intent or evidence is unclear, submit kind=clarification with one focused question. Otherwise submit kind=message. Finish with openloop_issue_chat_submit or openloop_issue_chat_fail, do not change issue status, and stop immediately after the tool result.",
        );
        const reply = await job.result;
        const persisted = appendCriticIssueChatMessage(
          input.database,
          input.issueId,
          reply,
        );
        finishModelRun(input.database, {
          id: runId,
          status: "completed",
          latencyMs: Math.round(performance.now() - startedAt),
        });
        input.events.emit(issue.documentId, {
          event: "issue_chat_updated",
          data: {
            issueId: issue.id,
            thread: persisted.thread,
            message: persisted.message,
          },
        });
      } catch (error) {
        input.broker.cancel(
          job.jobId,
          error instanceof Error ? error : new Error("Issue chat failed."),
        );
        finishModelRun(input.database, {
          id: runId,
          status: "error",
          latencyMs: Math.round(performance.now() - startedAt),
          errorCode: "MODEL_UNAVAILABLE",
        });
        const thread = markIssueChatError(input.database, input.issueId);
        const message =
          error instanceof Error ? error.message : "The critic chat failed.";
        input.events.emit(issue.documentId, {
          event: "issue_chat_updated",
          data: { issueId: issue.id, thread },
        });
        input.events.emit(issue.documentId, {
          event: "critic_error",
          data: {
            code: "MODEL_UNAVAILABLE",
            message,
            jobId: input.request.requestId,
          },
        });
      }
    })
    .catch((error: unknown) => {
      const issue = getIssue(input.database, input.issueId);
      const thread = markIssueChatError(input.database, input.issueId);
      const message =
        error instanceof Error ? error.message : "The critic chat failed.";
      input.events.emit(issue.documentId, {
        event: "issue_chat_updated",
        data: { issueId: issue.id, thread },
      });
      input.events.emit(issue.documentId, {
        event: "critic_error",
        data: {
          code: "MODEL_UNAVAILABLE",
          message,
          jobId: input.request.requestId,
        },
      });
    });
}
