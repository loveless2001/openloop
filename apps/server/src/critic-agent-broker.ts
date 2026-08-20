import { randomBytes, randomUUID } from "node:crypto";

import {
  ModelAdapterError,
  type CriticContextProvider,
  type CriticContextRequest,
  type CriticContextResponse,
  type CriticInput,
  type ModelErrorCode,
  type ReconcileInput,
} from "@openloop/model-adapters";
import { IssueCandidateSchema, ReconcileResultSchema } from "@openloop/shared";
import { z } from "zod";

const CriticCandidatesSchema = z.array(IssueCandidateSchema).max(3);

export type CriticCandidates = z.infer<typeof CriticCandidatesSchema>;
export type ReconciliationResult = z.infer<typeof ReconcileResultSchema>;

export interface CriticAgentClaim {
  jobId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  job: CriticInput;
}

export interface ReconciliationAgentClaim {
  jobId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  job: ReconcileInput;
}

interface BrokerJob {
  id: string;
  input: CriticInput;
  state: "pending" | "leased";
  leaseToken?: string;
  timeout: NodeJS.Timeout;
  expiresAtMs: number;
  signal: AbortSignal;
  contextProvider?: CriticContextProvider;
  contextRequestCount: number;
  abortHandler: () => void;
  resolve: (candidates: CriticCandidates) => void;
  reject: (error: ModelAdapterError) => void;
}

interface ReconciliationBrokerJob {
  id: string;
  input: ReconcileInput;
  state: "pending" | "leased";
  leaseToken?: string;
  timeout: NodeJS.Timeout;
  expiresAtMs: number;
  signal: AbortSignal;
  abortHandler: () => void;
  resolve: (result: ReconciliationResult) => void;
  reject: (error: ModelAdapterError) => void;
}

export class CriticAgentBrokerError extends Error {
  constructor(
    readonly code:
      | "CRITIC_JOB_NOT_FOUND"
      | "CRITIC_JOB_NOT_LEASED"
      | "CRITIC_JOB_LEASE_INVALID"
      | "CRITIC_CONTEXT_UNAVAILABLE"
      | "CRITIC_CONTEXT_LIMIT",
    message: string,
  ) {
    super(message);
  }
}

export class CriticAgentBroker {
  private readonly jobs = new Map<string, BrokerJob>();
  private readonly pending: string[] = [];
  private readonly reconciliationJobs = new Map<
    string,
    ReconciliationBrokerJob
  >();
  private readonly pendingReconciliations: string[] = [];

  constructor(private readonly timeoutMs: number) {}

  enqueue(
    input: CriticInput,
    signal: AbortSignal,
    contextProvider?: CriticContextProvider,
  ): {
    jobId: string;
    result: Promise<CriticCandidates>;
    shouldWake: boolean;
  } {
    const shouldWake = this.jobs.size + this.reconciliationJobs.size === 0;
    const jobId = randomUUID();
    let resolve!: BrokerJob["resolve"];
    let reject!: BrokerJob["reject"];
    const result = new Promise<CriticCandidates>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const abortHandler = () =>
      this.rejectJob(
        jobId,
        new ModelAdapterError("MODEL_ABORTED", "The critic job was aborted."),
      );
    const timeout = setTimeout(
      () =>
        this.rejectJob(
          jobId,
          new ModelAdapterError(
            "MODEL_TIMEOUT",
            "The critic CLI did not finish before the job lease expired.",
          ),
        ),
      this.timeoutMs,
    );
    const job: BrokerJob = {
      id: jobId,
      input,
      state: "pending",
      timeout,
      expiresAtMs: Date.now() + this.timeoutMs,
      signal,
      contextProvider,
      contextRequestCount: 0,
      abortHandler,
      resolve,
      reject,
    };
    this.jobs.set(jobId, job);
    this.pending.push(jobId);
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
    return { jobId, result, shouldWake };
  }

  claim(): CriticAgentClaim | null {
    if (this.hasLeasedJob()) {
      return null;
    }
    while (this.pending.length > 0) {
      const jobId = this.pending.shift();
      const job = jobId ? this.jobs.get(jobId) : undefined;
      if (!job || job.state !== "pending") continue;
      const leaseToken = randomBytes(32).toString("hex");
      job.state = "leased";
      job.leaseToken = leaseToken;
      return {
        jobId: job.id,
        leaseToken,
        leaseExpiresAt: new Date(job.expiresAtMs).toISOString(),
        job: job.input,
      };
    }
    return null;
  }

  submit(jobId: string, leaseToken: string, candidates: unknown): boolean {
    const job = this.requireLease(jobId, leaseToken);
    const parsed = CriticCandidatesSchema.parse(candidates);
    this.finish(job);
    job.resolve(parsed);
    return this.hasPendingJob();
  }

  async requestContext(
    jobId: string,
    leaseToken: string,
    request: CriticContextRequest,
  ): Promise<CriticContextResponse> {
    const job = this.requireLease(jobId, leaseToken);
    if (!job.contextProvider || !job.input.contextPolicy.canRequestMore) {
      throw new CriticAgentBrokerError(
        "CRITIC_CONTEXT_UNAVAILABLE",
        "Additional document context is not available for this job.",
      );
    }
    if (job.contextRequestCount >= job.input.contextPolicy.maxRequests) {
      throw new CriticAgentBrokerError(
        "CRITIC_CONTEXT_LIMIT",
        "The context request limit for this job has been reached.",
      );
    }
    const limit = job.input.contextPolicy.maxBlocksPerSide;
    if (
      request.beforeBlocks > limit ||
      request.afterBlocks > limit ||
      request.beforeBlocks + request.afterBlocks === 0
    ) {
      throw new CriticAgentBrokerError(
        "CRITIC_CONTEXT_LIMIT",
        `Request at least one and no more than ${limit} blocks per side.`,
      );
    }
    job.contextRequestCount += 1;
    return job.contextProvider(request, job.signal);
  }

  fail(
    jobId: string,
    leaseToken: string,
    code: ModelErrorCode,
    message: string,
  ): boolean {
    const job = this.requireLease(jobId, leaseToken);
    this.finish(job);
    job.reject(new ModelAdapterError(code, message));
    return this.hasPendingJob();
  }

  enqueueReconciliation(
    input: ReconcileInput,
    signal: AbortSignal,
  ): {
    jobId: string;
    result: Promise<ReconciliationResult>;
    shouldWake: boolean;
  } {
    const shouldWake = this.jobs.size + this.reconciliationJobs.size === 0;
    const jobId = randomUUID();
    let resolve!: ReconciliationBrokerJob["resolve"];
    let reject!: ReconciliationBrokerJob["reject"];
    const result = new Promise<ReconciliationResult>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    const abortHandler = () =>
      this.rejectReconciliation(
        jobId,
        new ModelAdapterError(
          "MODEL_ABORTED",
          "The reconciliation job was aborted.",
        ),
      );
    const timeout = setTimeout(
      () =>
        this.rejectReconciliation(
          jobId,
          new ModelAdapterError(
            "MODEL_TIMEOUT",
            "The critic CLI did not reconcile the issue before the lease expired.",
          ),
        ),
      this.timeoutMs,
    );
    const job: ReconciliationBrokerJob = {
      id: jobId,
      input,
      state: "pending",
      timeout,
      expiresAtMs: Date.now() + this.timeoutMs,
      signal,
      abortHandler,
      resolve,
      reject,
    };
    this.reconciliationJobs.set(jobId, job);
    this.pendingReconciliations.push(jobId);
    signal.addEventListener("abort", abortHandler, { once: true });
    if (signal.aborted) abortHandler();
    return { jobId, result, shouldWake };
  }

  claimReconciliation(): ReconciliationAgentClaim | null {
    if (this.hasLeasedJob()) return null;
    while (this.pendingReconciliations.length > 0) {
      const jobId = this.pendingReconciliations.shift();
      const job = jobId ? this.reconciliationJobs.get(jobId) : undefined;
      if (!job || job.state !== "pending") continue;
      const leaseToken = randomBytes(32).toString("hex");
      job.state = "leased";
      job.leaseToken = leaseToken;
      return {
        jobId: job.id,
        leaseToken,
        leaseExpiresAt: new Date(job.expiresAtMs).toISOString(),
        job: job.input,
      };
    }
    return null;
  }

  submitReconciliation(
    jobId: string,
    leaseToken: string,
    result: unknown,
  ): boolean {
    const job = this.requireReconciliationLease(jobId, leaseToken);
    const parsed = ReconcileResultSchema.parse(result);
    this.finishReconciliation(job);
    job.resolve(parsed);
    return this.hasPendingJob();
  }

  failReconciliation(
    jobId: string,
    leaseToken: string,
    code: ModelErrorCode,
    message: string,
  ): boolean {
    const job = this.requireReconciliationLease(jobId, leaseToken);
    this.finishReconciliation(job);
    job.reject(new ModelAdapterError(code, message));
    return this.hasPendingJob();
  }

  cancelReconciliation(jobId: string, error: ModelAdapterError): void {
    this.rejectReconciliation(jobId, error);
  }

  cancel(jobId: string, error: ModelAdapterError): void {
    this.rejectJob(jobId, error);
  }

  getStatus(): { pending: number; leased: number } {
    let pending = 0;
    let leased = 0;
    for (const job of this.jobs.values()) {
      if (job.state === "pending") pending += 1;
      else leased += 1;
    }
    for (const job of this.reconciliationJobs.values()) {
      if (job.state === "pending") pending += 1;
      else leased += 1;
    }
    return { pending, leased };
  }

  close(): void {
    for (const job of [...this.jobs.values()]) {
      this.rejectJob(
        job.id,
        new ModelAdapterError(
          "MODEL_ABORTED",
          "OpenLoop shut down before the critic job completed.",
        ),
      );
    }
    for (const job of [...this.reconciliationJobs.values()]) {
      this.rejectReconciliation(
        job.id,
        new ModelAdapterError(
          "MODEL_ABORTED",
          "OpenLoop shut down before reconciliation completed.",
        ),
      );
    }
  }

  private requireLease(jobId: string, leaseToken: string): BrokerJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new CriticAgentBrokerError(
        "CRITIC_JOB_NOT_FOUND",
        "The critic job is no longer active.",
      );
    }
    if (job.state !== "leased") {
      throw new CriticAgentBrokerError(
        "CRITIC_JOB_NOT_LEASED",
        "The critic job has not been claimed.",
      );
    }
    if (job.leaseToken !== leaseToken) {
      throw new CriticAgentBrokerError(
        "CRITIC_JOB_LEASE_INVALID",
        "The critic job lease is invalid.",
      );
    }
    return job;
  }

  private rejectJob(jobId: string, error: ModelAdapterError): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.finish(job);
    job.reject(error);
  }

  private requireReconciliationLease(
    jobId: string,
    leaseToken: string,
  ): ReconciliationBrokerJob {
    const job = this.reconciliationJobs.get(jobId);
    if (!job) {
      throw new CriticAgentBrokerError(
        "CRITIC_JOB_NOT_FOUND",
        "The reconciliation job is no longer active.",
      );
    }
    if (job.state !== "leased") {
      throw new CriticAgentBrokerError(
        "CRITIC_JOB_NOT_LEASED",
        "The reconciliation job has not been claimed.",
      );
    }
    if (job.leaseToken !== leaseToken) {
      throw new CriticAgentBrokerError(
        "CRITIC_JOB_LEASE_INVALID",
        "The reconciliation job lease is invalid.",
      );
    }
    return job;
  }

  private rejectReconciliation(jobId: string, error: ModelAdapterError): void {
    const job = this.reconciliationJobs.get(jobId);
    if (!job) return;
    this.finishReconciliation(job);
    job.reject(error);
  }

  private finishReconciliation(job: ReconciliationBrokerJob): void {
    clearTimeout(job.timeout);
    job.signal.removeEventListener("abort", job.abortHandler);
    this.reconciliationJobs.delete(job.id);
  }

  private hasLeasedJob(): boolean {
    return (
      [...this.jobs.values()].some((job) => job.state === "leased") ||
      [...this.reconciliationJobs.values()].some(
        (job) => job.state === "leased",
      )
    );
  }

  private hasPendingJob(): boolean {
    return (
      this.pending.some((id) => this.jobs.has(id)) ||
      this.pendingReconciliations.some((id) => this.reconciliationJobs.has(id))
    );
  }

  private finish(job: BrokerJob): void {
    clearTimeout(job.timeout);
    job.signal.removeEventListener("abort", job.abortHandler);
    this.jobs.delete(job.id);
  }
}
