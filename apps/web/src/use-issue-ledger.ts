import {
  IssueRecordSchema,
  type EditorOperation,
  type IssueActionRequest,
  type IssueEventRecord,
  type IssueRecord,
} from "@openloop/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadIssueEvents, loadIssues, performIssueAction } from "./api.js";

const CRITIC_EVENTS = [
  "issue_created",
  "issue_updated",
  "issue_eligible",
  "issue_resolved",
  "issue_invalidated",
] as const;

export function useIssueLedger(input: {
  documentId?: string;
  documentVersion: number;
  onStatus: (message?: string, durationMs?: number) => void;
}) {
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string>();
  const [events, setEvents] = useState<IssueEventRecord[]>([]);
  const [actionPending, setActionPending] = useState(false);
  const statusRef = useRef(input.onStatus);
  statusRef.current = input.onStatus;

  const refresh = useCallback(async () => {
    if (!input.documentId) return;
    try {
      const loaded = await loadIssues(input.documentId);
      setIssues(loaded);
      setSelectedIssueId((current) =>
        current && loaded.some((issue) => issue.id === current)
          ? current
          : undefined,
      );
    } catch (error) {
      statusRef.current(
        error instanceof Error ? error.message : "Could not load issues.",
        2_500,
      );
    }
  }, [input.documentId]);

  useEffect(() => {
    setIssues([]);
    setSelectedIssueId(undefined);
    void refresh();
    if (!input.documentId || typeof EventSource === "undefined") return;

    let disposed = false;
    let eventSource: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;
    let retryMs = 1_000;

    const stopPolling = () => {
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      pollTimer = undefined;
    };
    const startPolling = () => {
      if (pollTimer === undefined) {
        pollTimer = window.setInterval(() => void refresh(), 2_000);
      }
    };
    const connect = () => {
      if (disposed || !input.documentId) return;
      eventSource = new EventSource(
        `/v1/documents/${input.documentId}/critic-events`,
      );
      eventSource.onopen = () => {
        retryMs = 1_000;
        stopPolling();
      };
      for (const eventName of CRITIC_EVENTS) {
        eventSource.addEventListener(eventName, (event) => {
          const payload: unknown = JSON.parse((event as MessageEvent).data);
          const issue = IssueRecordSchema.parse(
            (payload as { issue: unknown }).issue,
          );
          setIssues((current) => [
            issue,
            ...current.filter((entry) => entry.id !== issue.id),
          ]);
          if (eventName === "issue_eligible") {
            setSelectedIssueId((current) => current ?? issue.id);
          }
        });
      }
      eventSource.addEventListener("critic_error", () => {
        statusRef.current("Critic unavailable", 2_500);
      });
      eventSource.onerror = () => {
        eventSource?.close();
        startPolling();
        reconnectTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 10_000);
      };
    };
    connect();
    return () => {
      disposed = true;
      eventSource?.close();
      stopPolling();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    };
  }, [input.documentId, refresh]);

  useEffect(() => {
    if (!selectedIssueId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    void loadIssueEvents(selectedIssueId)
      .then((loaded) => {
        if (!cancelled) setEvents(loaded);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedIssueId, issues]);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId),
    [issues, selectedIssueId],
  );

  const act = useCallback(
    async (
      issue: IssueRecord,
      action: IssueActionRequest["action"],
    ): Promise<EditorOperation | undefined> => {
      setActionPending(true);
      try {
        const result = await performIssueAction(
          issue.id,
          action === "apply_rewrite"
            ? {
                action,
                documentVersion: input.documentVersion,
                expectedAnchorQuote: issue.anchor.quote,
              }
            : { action, documentVersion: input.documentVersion },
        );
        setIssues((current) => [
          result.issue,
          ...current.filter((entry) => entry.id !== result.issue.id),
        ]);
        return result.editorOperation;
      } catch (error) {
        statusRef.current(
          error instanceof Error ? error.message : "Issue action failed.",
          2_500,
        );
        return undefined;
      } finally {
        setActionPending(false);
      }
    },
    [input.documentVersion],
  );

  return {
    actionPending,
    act,
    events,
    issues,
    refresh,
    selectedIssue,
    selectedIssueId,
    selectIssue: setSelectedIssueId,
  };
}
