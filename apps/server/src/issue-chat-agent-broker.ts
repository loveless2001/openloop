import { randomBytes, randomUUID } from "node:crypto";

import {
  IssueChatReplySchema,
  type IssueChatMessage,
  type IssueChatReply,
  type IssueRecord,
} from "@openloop/shared";

export interface IssueChatAgentInput {
  requestId: string;
  documentTitle: string;
  documentVersion: number;
  issue: Pick<
    IssueRecord,
    | "id"
    | "type"
    | "status"
    | "question"
    | "rationale"
    | "suggestedRewrite"
    | "severity"
    | "anchor"
  >;
  messages: IssueChatMessage[];
}

interface ChatJob {
  id: string;
  input: IssueChatAgentInput;
  leaseToken?: string;
  timeout: NodeJS.Timeout;
  resolve: (reply: IssueChatReply) => void;
  reject: (error: Error) => void;
}

export class IssueChatAgentBrokerError extends Error {
  constructor(
    readonly code:
      | "ISSUE_CHAT_JOB_NOT_FOUND"
      | "ISSUE_CHAT_JOB_NOT_LEASED"
      | "ISSUE_CHAT_JOB_LEASE_INVALID",
    message: string,
  ) {
    super(message);
  }
}

export class IssueChatAgentBroker {
  private job?: ChatJob;

  constructor(private readonly timeoutMs: number) {}

  enqueue(input: IssueChatAgentInput): {
    jobId: string;
    result: Promise<IssueChatReply>;
  } {
    if (this.job) throw new Error("An issue chat job is already active.");
    const jobId = randomUUID();
    let resolve!: ChatJob["resolve"];
    let reject!: ChatJob["reject"];
    const result = new Promise<IssueChatReply>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const timeout = setTimeout(() => {
      if (this.job?.id !== jobId) return;
      this.job = undefined;
      reject(new Error("The critic CLI did not reply before the timeout."));
    }, this.timeoutMs);
    this.job = { id: jobId, input, timeout, resolve, reject };
    return { jobId, result };
  }

  claim() {
    if (!this.job || this.job.leaseToken) return null;
    this.job.leaseToken = randomBytes(32).toString("hex");
    return {
      jobId: this.job.id,
      leaseToken: this.job.leaseToken,
      leaseExpiresAt: new Date(Date.now() + this.timeoutMs).toISOString(),
      job: this.job.input,
    };
  }

  submit(jobId: string, leaseToken: string, reply: unknown): void {
    const job = this.requireLease(jobId, leaseToken);
    const parsed = IssueChatReplySchema.parse(reply);
    this.finish(job);
    job.resolve(parsed);
  }

  fail(jobId: string, leaseToken: string, message: string): void {
    const job = this.requireLease(jobId, leaseToken);
    this.finish(job);
    job.reject(new Error(message));
  }

  cancel(jobId: string, error: Error): void {
    if (this.job?.id !== jobId) return;
    const job = this.job;
    this.finish(job);
    job.reject(error);
  }

  getStatus(): { pending: number; leased: number } {
    return {
      pending: this.job && !this.job.leaseToken ? 1 : 0,
      leased: this.job?.leaseToken ? 1 : 0,
    };
  }

  close(): void {
    if (!this.job) return;
    const job = this.job;
    this.finish(job);
    job.reject(
      new Error("OpenLoop shut down before the chat reply completed."),
    );
  }

  private requireLease(jobId: string, leaseToken: string): ChatJob {
    if (!this.job || this.job.id !== jobId) {
      throw new IssueChatAgentBrokerError(
        "ISSUE_CHAT_JOB_NOT_FOUND",
        "The issue chat job is no longer active.",
      );
    }
    if (!this.job.leaseToken) {
      throw new IssueChatAgentBrokerError(
        "ISSUE_CHAT_JOB_NOT_LEASED",
        "The issue chat job has not been claimed.",
      );
    }
    if (this.job.leaseToken !== leaseToken) {
      throw new IssueChatAgentBrokerError(
        "ISSUE_CHAT_JOB_LEASE_INVALID",
        "The issue chat job lease is invalid.",
      );
    }
    return this.job;
  }

  private finish(job: ChatJob): void {
    clearTimeout(job.timeout);
    if (this.job?.id === job.id) this.job = undefined;
  }
}
