import {
  IssueChatMessageSchema,
  IssueChatThreadSchema,
  type IssueChatAttachmentInput,
  type IssueChatMessage,
  type IssueChatThread,
} from "@openloop/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  activateIssueChat,
  loadIssueChat,
  sendIssueChatMessage,
} from "./api.js";
import type { EditorCriticSelection } from "./editor/critic-selection.js";

interface DraftState {
  content: string;
  attachments: IssueChatAttachmentInput[];
}

const emptyDraft: DraftState = { content: "", attachments: [] };

export function useIssueChat(input: {
  documentId?: string;
  documentVersion: number;
  issueId?: string;
  onStatus: (message?: string, durationMs?: number) => void;
}) {
  const [thread, setThread] = useState<IssueChatThread>();
  const [messages, setMessages] = useState<IssueChatMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(false);
  const [loading, setLoading] = useState(false);
  const issueIdRef = useRef(input.issueId);
  const collapsedRef = useRef(collapsed);
  const statusRef = useRef(input.onStatus);
  issueIdRef.current = input.issueId;
  collapsedRef.current = collapsed;
  statusRef.current = input.onStatus;

  const mergeMessage = useCallback((message: IssueChatMessage) => {
    setMessages((current) => [
      ...current.filter((entry) => entry.id !== message.id),
      message,
    ]);
  }, []);

  useEffect(() => {
    if (!input.issueId) {
      setThread(undefined);
      setMessages([]);
      setCollapsed(false);
      setUnread(false);
      return;
    }
    let cancelled = false;
    setThread(undefined);
    setMessages([]);
    setLoading(true);
    setCollapsed(false);
    setUnread(false);
    void activateIssueChat(input.issueId)
      .then((chat) => {
        if (cancelled) return;
        setThread(chat.thread);
        setMessages(chat.messages);
      })
      .catch(async (error) => {
        try {
          const chat = await loadIssueChat(input.issueId!);
          if (!cancelled) {
            setThread(chat.thread);
            setMessages(chat.messages);
          }
        } catch {
          if (!cancelled) {
            statusRef.current(
              error instanceof Error
                ? error.message
                : "Could not open issue chat.",
              3_000,
            );
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [input.issueId]);

  useEffect(() => {
    if (!input.documentId || typeof EventSource === "undefined") return;
    const source = new EventSource(
      `/v1/documents/${input.documentId}/critic-events`,
    );
    source.addEventListener("issue_chat_updated", (event) => {
      const payload: unknown = JSON.parse((event as MessageEvent).data);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("issueId" in payload) ||
        payload.issueId !== issueIdRef.current ||
        !("thread" in payload)
      ) {
        return;
      }
      setThread(IssueChatThreadSchema.parse(payload.thread));
      if ("message" in payload && payload.message) {
        const message = IssueChatMessageSchema.parse(payload.message);
        mergeMessage(message);
        if (message.role === "critic" && collapsedRef.current) setUnread(true);
      }
    });
    return () => source.close();
  }, [input.documentId, mergeMessage]);

  const draft = input.issueId
    ? (drafts[input.issueId] ?? emptyDraft)
    : emptyDraft;

  const updateDraft = useCallback(
    (update: (current: DraftState) => DraftState) => {
      if (!input.issueId) return;
      setDrafts((current) => ({
        ...current,
        [input.issueId!]: update(current[input.issueId!] ?? emptyDraft),
      }));
    },
    [input.issueId],
  );

  const addSelection = useCallback(
    (selection: EditorCriticSelection) => {
      updateDraft((current) => ({
        ...current,
        attachments: [
          ...current.attachments,
          {
            source: selection.source,
            text: selection.text,
            wordCount: selection.wordCount,
            blocks: selection.blocks,
          },
        ],
      }));
      setCollapsed(false);
      setUnread(false);
    },
    [updateDraft],
  );

  const removeAttachment = useCallback(
    (index: number) =>
      updateDraft((current) => ({
        ...current,
        attachments: current.attachments.filter((_, entry) => entry !== index),
      })),
    [updateDraft],
  );

  const send = useCallback(async () => {
    if (!input.issueId || thread?.state === "waiting_on_critic") return;
    const current = drafts[input.issueId] ?? emptyDraft;
    if (!current.content.trim() && current.attachments.length === 0) return;
    try {
      const response = await sendIssueChatMessage(input.issueId, {
        requestId: crypto.randomUUID(),
        documentVersion: input.documentVersion,
        content: current.content,
        attachments: current.attachments,
      });
      setThread(response.thread);
      mergeMessage(response.message);
      setDrafts((all) => ({ ...all, [input.issueId!]: emptyDraft }));
    } catch (error) {
      statusRef.current(
        error instanceof Error ? error.message : "Could not send chat message.",
        3_000,
      );
    }
  }, [
    drafts,
    input.documentVersion,
    input.issueId,
    mergeMessage,
    thread?.state,
  ]);

  const attachmentWordCount = useMemo(
    () => draft.attachments.reduce((sum, entry) => sum + entry.wordCount, 0),
    [draft.attachments],
  );

  return {
    addSelection,
    attachmentWordCount,
    attachments: draft.attachments,
    collapsed,
    content: draft.content,
    loading,
    messages,
    removeAttachment,
    send,
    setCollapsed: (value: boolean) => {
      setCollapsed(value);
      if (!value) setUnread(false);
    },
    setContent: (content: string) =>
      updateDraft((current) => ({ ...current, content })),
    thread,
    unread,
  };
}
