import type {
  IssueChatAttachmentInput,
  IssueChatMessage,
  IssueChatThread,
  IssueEventRecord,
  IssueRecord,
} from "@openloop/shared";
import { useEffect, useRef } from "react";

function label(value: string): string {
  return value.replaceAll("_", " ");
}

export function IssueChatDrawer(props: {
  actionPending: boolean;
  attachments: IssueChatAttachmentInput[];
  collapsed: boolean;
  content: string;
  events: IssueEventRecord[];
  issue: IssueRecord;
  loading: boolean;
  messages: IssueChatMessage[];
  thread?: IssueChatThread;
  unread: boolean;
  onAction: (
    issue: IssueRecord,
    action: "apply_rewrite" | "snooze" | "dismiss" | "resolve" | "reopen",
  ) => void;
  onClose: () => void;
  onCollapse: (collapsed: boolean) => void;
  onContentChange: (content: string) => void;
  onRemoveAttachment: (index: number) => void;
  onSend: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.collapsed) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [props.collapsed, props.messages.length, props.thread?.state]);

  if (props.collapsed) {
    return (
      <section className="issue-chat-collapsed" aria-label="Current issue chat">
        <button
          className="issue-chat-expand"
          onClick={() => props.onCollapse(false)}
          type="button"
        >
          <span className="issue-chat-state-dot" data-unread={props.unread} />
          <span>
            <small>Current chat</small>
            <strong>{props.issue.question}</strong>
          </span>
          <span aria-hidden="true">↑</span>
        </button>
      </section>
    );
  }

  const active = ["open", "snoozed", "needs_review"].includes(
    props.issue.status,
  );
  const canSend =
    props.thread?.state !== "waiting_on_critic" &&
    (props.content.trim().length > 0 || props.attachments.length > 0);

  return (
    <section className="issue-chat" aria-label="Current issue chat">
      <header className="issue-chat-header">
        <div>
          <p className="eyebrow">{label(props.issue.type)} · active chat</p>
          <h3>{props.issue.question}</h3>
        </div>
        <div className="issue-chat-window-actions">
          <button
            aria-label="Collapse issue chat"
            onClick={() => props.onCollapse(true)}
            title="Collapse chat"
            type="button"
          >
            —
          </button>
          <button
            aria-label="Close issue chat"
            onClick={props.onClose}
            title="Close chat"
            type="button"
          >
            ×
          </button>
        </div>
      </header>

      <div className="issue-chat-summary">
        <p>{props.issue.rationale}</p>
        <blockquote>{props.issue.anchor.quote}</blockquote>
        {props.issue.anchor.detached ? (
          <p className="issue-warning">
            Anchor detached from the current text.
          </p>
        ) : null}
      </div>

      <div className="issue-chat-status-actions" aria-label="Issue status">
        <span data-status={props.issue.status}>
          {label(props.issue.status)}
        </span>
        {props.issue.suggestedRewrite &&
        !props.issue.anchor.detached &&
        active ? (
          <button
            disabled={props.actionPending}
            onClick={() => props.onAction(props.issue, "apply_rewrite")}
            type="button"
          >
            Apply rewrite
          </button>
        ) : null}
        {active ? (
          <>
            <button
              disabled={props.actionPending}
              onClick={() => props.onAction(props.issue, "snooze")}
              type="button"
            >
              Later
            </button>
            <button
              disabled={props.actionPending}
              onClick={() => props.onAction(props.issue, "dismiss")}
              type="button"
            >
              Dismiss
            </button>
            <button
              disabled={props.actionPending}
              onClick={() => props.onAction(props.issue, "resolve")}
              type="button"
            >
              Resolve
            </button>
          </>
        ) : ["resolved", "dismissed"].includes(props.issue.status) ? (
          <button
            disabled={props.actionPending}
            onClick={() => props.onAction(props.issue, "reopen")}
            type="button"
          >
            Reopen
          </button>
        ) : null}
      </div>

      <div className="issue-chat-messages" aria-live="polite">
        {props.loading ? (
          <p className="issue-chat-muted">Opening chat…</p>
        ) : null}
        {!props.loading && props.messages.length === 0 ? (
          <p className="issue-chat-muted">
            Ask a follow-up or highlight text and add it to this chat.
          </p>
        ) : null}
        {props.messages.map((message) => (
          <article
            className="issue-chat-message"
            data-kind={message.kind}
            data-role={message.role}
            key={message.id}
          >
            <small>
              {message.role === "critic" ? "Critic" : "You"}
              {message.kind === "clarification" ? " · needs context" : ""}
            </small>
            {message.content ? <p>{message.content}</p> : null}
            {message.attachments.map((attachment) => (
              <blockquote key={attachment.id}>
                {attachment.text}
                <small>{attachment.wordCount} words attached</small>
              </blockquote>
            ))}
          </article>
        ))}
        {props.thread?.state === "waiting_on_critic" ? (
          <p className="issue-chat-thinking">Critic is responding…</p>
        ) : null}
        {props.thread?.state === "error" ? (
          <p className="issue-warning">
            The last reply failed. Your message is still saved; try again.
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="issue-chat-composer">
        {props.attachments.length > 0 ? (
          <ul className="issue-chat-attachments" aria-label="Attached text">
            {props.attachments.map((attachment, index) => (
              <li key={`${attachment.blocks[0]?.nodeId ?? "text"}-${index}`}>
                <span>
                  “{attachment.text.slice(0, 72)}
                  {attachment.text.length > 72 ? "…" : ""}”
                </span>
                <small>{attachment.wordCount} words</small>
                <button
                  aria-label={`Remove attachment ${index + 1}`}
                  onClick={() => props.onRemoveAttachment(index)}
                  type="button"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          aria-label="Reply to critic"
          maxLength={4_000}
          onChange={(event) => props.onContentChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (canSend) props.onSend();
            }
          }}
          placeholder="Reply to the critic…"
          rows={3}
          value={props.content}
        />
        <div className="issue-chat-send-row">
          <small>Ctrl/⌘ + Enter to send</small>
          <button disabled={!canSend} onClick={props.onSend} type="button">
            Send
          </button>
        </div>
      </div>

      <details className="issue-chat-history">
        <summary>Issue history ({props.events.length})</summary>
        <ol>
          {props.events.map((event) => (
            <li key={event.id}>
              {label(event.action)} ·{" "}
              {new Date(event.createdAt).toLocaleTimeString()}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
