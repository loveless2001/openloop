import type { IssueRecord } from "@openloop/shared";

export type CriticEvent =
  | {
      event:
        | "issue_created"
        | "issue_updated"
        | "issue_eligible"
        | "issue_resolved"
        | "issue_invalidated";
      data: { issue: IssueRecord; jobId: string };
    }
  | {
      event: "critic_error";
      data: { code: string; message: string; jobId: string };
    };

type Listener = (event: CriticEvent) => void;

export class CriticEventBroker {
  private readonly listeners = new Map<string, Set<Listener>>();

  emit(documentId: string, event: CriticEvent): void {
    for (const listener of this.listeners.get(documentId) ?? [])
      listener(event);
  }

  subscribe(documentId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(documentId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(documentId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(documentId);
    };
  }
}
