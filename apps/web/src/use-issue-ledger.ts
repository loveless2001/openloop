import {
  IssueRecordSchema,
  type EditorOperation,
  type IssueActionRequest,
  type IssueEventRecord,
  type IssueRecord,
  type ResurfaceTriggerName,
  type TextBlockSnapshot,
} from "@openloop/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadIssueEvents,
  loadIssues,
  performIssueAction,
  requestResurfacing,
} from "./api.js";
import { criticErrorMessage } from "./critic-error.js";

const CRITIC_EVENTS = [
  "issue_created",
  "issue_updated",
  "issue_eligible",
  "issue_resolved",
  "issue_invalidated",
] as const;

export function isTwoBlocksAway(
  anchorNodeId: string,
  currentNodeId: string,
  orderedNodeIds: string[],
): boolean {
  const anchorIndex = orderedNodeIds.indexOf(anchorNodeId);
  const currentIndex = orderedNodeIds.indexOf(currentNodeId);
  return (
    anchorIndex >= 0 &&
    currentIndex >= 0 &&
    Math.abs(currentIndex - anchorIndex) >= 2
  );
}

export function useIssueLedger(input: {
  documentId?: string;
  documentVersion: number;
  isCompletionVisible?: () => boolean;
  onStatus: (message?: string, durationMs?: number) => void;
}) {
  const [issues, setIssues] = useState<IssueRecord[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string>();
  const [events, setEvents] = useState<IssueEventRecord[]>([]);
  const [actionPending, setActionPending] = useState(false);
  const automaticAttentionRef = useRef<
    | {
        issueId: string;
        anchorNodeId: string;
        shownAt: number;
      }
    | undefined
  >(undefined);
  const issuesRef = useRef(issues);
  const selectedIssueIdRef = useRef(selectedIssueId);
  const lastActivityAtRef = useRef(Date.now());
  const versionRef = useRef(input.documentVersion);
  const completionVisibleRef = useRef(input.isCompletionVisible);
  const statusRef = useRef(input.onStatus);
  issuesRef.current = issues;
  selectedIssueIdRef.current = selectedIssueId;
  versionRef.current = input.documentVersion;
  completionVisibleRef.current = input.isCompletionVisible;
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
          const payload = JSON.parse((event as MessageEvent).data) as {
            automatic?: boolean;
            issue: unknown;
            trigger?: ResurfaceTriggerName;
          };
          const issue = IssueRecordSchema.parse(payload.issue);
          setIssues((current) => [
            issue,
            ...current.filter((entry) => entry.id !== issue.id),
          ]);
          if (eventName === "issue_eligible") {
            if (payload.automatic !== false) {
              automaticAttentionRef.current = {
                issueId: issue.id,
                anchorNodeId: issue.anchor.nodeId,
                shownAt: Date.now(),
              };
            } else if (automaticAttentionRef.current?.issueId === issue.id) {
              automaticAttentionRef.current = undefined;
            }
            if (issue.shownCount > 1) {
              statusRef.current("Still open — this issue is relevant again.");
            }
            setSelectedIssueId((current) => current ?? issue.id);
          } else if (
            eventName === "issue_updated" &&
            payload.trigger === "severity_escalated" &&
            input.documentId
          ) {
            void requestResurfacing(input.documentId, {
              documentVersion: versionRef.current,
              trigger: "severity_escalated",
              changedBlocks: [],
              candidateIssueId: issue.id,
              attention: {
                userIdleMs: Date.now() - lastActivityAtRef.current,
                completionVisible: Boolean(completionVisibleRef.current?.()),
                issueCardExpanded: Boolean(selectedIssueIdRef.current),
              },
            }).catch(() => undefined);
          }
        });
      }
      eventSource.addEventListener("critic_error", (event) => {
        statusRef.current(
          criticErrorMessage((event as MessageEvent).data),
          5_000,
        );
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
    ): Promise<
      { editorOperation?: EditorOperation; issue: IssueRecord } | undefined
    > => {
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
        if (automaticAttentionRef.current?.issueId === issue.id) {
          automaticAttentionRef.current = undefined;
        }
        return {
          issue: result.issue,
          ...(result.editorOperation
            ? { editorOperation: result.editorOperation }
            : {}),
        };
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

  const resurface = useCallback(
    async (
      trigger: ResurfaceTriggerName,
      changedBlocks: TextBlockSnapshot[] = [],
      documentVersion = versionRef.current,
      attention = {
        userIdleMs: 0,
        completionVisible: false,
        issueCardExpanded: Boolean(selectedIssueId),
      },
    ) => {
      if (!input.documentId) return;
      try {
        const result = await requestResurfacing(input.documentId, {
          documentVersion,
          trigger,
          changedBlocks,
          attention,
        });
        if (!result.issue) return;
        setIssues((current) => [
          result.issue!,
          ...current.filter((entry) => entry.id !== result.issue!.id),
        ]);
        if (trigger !== "manual_review" && trigger !== "before_export") {
          automaticAttentionRef.current = {
            issueId: result.issue.id,
            anchorNodeId: result.issue.anchor.nodeId,
            shownAt: Date.now(),
          };
        } else if (automaticAttentionRef.current?.issueId === result.issue.id) {
          automaticAttentionRef.current = undefined;
        }
        setSelectedIssueId((current) => current ?? result.issue!.id);
        statusRef.current("Still open — this issue is relevant again.");
        return result.issue;
      } catch (error) {
        statusRef.current(
          error instanceof Error
            ? error.message
            : "Could not review open loops.",
          2_500,
        );
      }
    },
    [input.documentId, selectedIssueId],
  );

  const recordSilentIgnore = useCallback((qualifies: boolean) => {
    if (!qualifies) return;
    const automatic = automaticAttentionRef.current;
    if (!automatic || Date.now() - automatic.shownAt < 30_000) return;
    const issue = issuesRef.current.find(
      (candidate) => candidate.id === automatic.issueId,
    );
    if (!issue || issue.status !== "open") return;
    automaticAttentionRef.current = undefined;
    void performIssueAction(issue.id, {
      action: "silent_ignore",
      documentVersion: versionRef.current,
    })
      .then((result) => {
        setIssues((current) => [
          result.issue,
          ...current.filter((entry) => entry.id !== result.issue.id),
        ]);
        setSelectedIssueId((current) =>
          current === issue.id ? undefined : current,
        );
      })
      .catch(() => undefined);
  }, []);

  const noteMeaningfulEdit = useCallback(
    (blocks: TextBlockSnapshot[]) => {
      lastActivityAtRef.current = Date.now();
      const automatic = automaticAttentionRef.current;
      recordSilentIgnore(
        Boolean(
          automatic &&
          blocks.some((block) => block.nodeId !== automatic.anchorNodeId),
        ),
      );
    },
    [recordSilentIgnore],
  );

  const noteCursorMove = useCallback(
    (currentNodeId: string, orderedNodeIds: string[]) => {
      lastActivityAtRef.current = Date.now();
      const automatic = automaticAttentionRef.current;
      recordSilentIgnore(
        Boolean(
          automatic &&
          isTwoBlocksAway(
            automatic.anchorNodeId,
            currentNodeId,
            orderedNodeIds,
          ),
        ),
      );
    },
    [recordSilentIgnore],
  );

  const selectIssue = useCallback((issueId?: string) => {
    automaticAttentionRef.current = undefined;
    setSelectedIssueId(issueId);
  }, []);

  return {
    actionPending,
    act,
    events,
    issues,
    noteMeaningfulEdit,
    noteCursorMove,
    refresh,
    resurface,
    selectedIssue,
    selectedIssueId,
    selectIssue,
  };
}
