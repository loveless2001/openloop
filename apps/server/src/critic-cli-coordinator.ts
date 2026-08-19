import type { CriticAgentController } from "./critic-agent-supervisor.js";

export class CriticCliCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private activeIssueId?: string;

  constructor(private readonly controller: CriticAgentController) {}

  activateIssue(issueId: string): Promise<void> {
    return this.serialize(async () => {
      await this.switchToIssue(issueId);
    });
  }

  runIssueTurn<T>(issueId: string, task: () => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      await this.switchToIssue(issueId);
      return task();
    });
  }

  runCriticTurn<T>(task: () => Promise<T>): Promise<T> {
    return this.serialize(async () => {
      if (this.activeIssueId) {
        await this.resetConversation();
        this.activeIssueId = undefined;
      }
      return task();
    });
  }

  private async switchToIssue(issueId: string): Promise<void> {
    if (this.activeIssueId === issueId) return;
    await this.resetConversation();
    this.activeIssueId = issueId;
  }

  private resetConversation(): Promise<void> {
    if (this.controller.resetConversation) {
      return this.controller.resetConversation();
    }
    if (this.controller.wake) return this.controller.wake("/clear");
    return Promise.reject(
      new Error("The managed critic controller cannot reset its conversation."),
    );
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
