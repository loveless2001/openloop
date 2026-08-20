import {
  ModelAdapterError,
  type CompletionChunk,
  type CriticContextProvider,
  type CriticInput,
  type ModelAdapter,
  type ReconcileInput,
} from "@openloop/model-adapters";

import type { CriticAgentBroker } from "../critic-agent-broker.js";
import type { CriticCliCoordinator } from "../critic-cli-coordinator.js";

export class CliCriticAdapter implements ModelAdapter {
  readonly providerId = "cli-agent";
  readonly capabilities = {
    streaming: false,
    jsonSchema: true,
    cancellation: true,
  } as const;

  constructor(
    private readonly broker: CriticAgentBroker,
    private readonly coordinator: CriticCliCoordinator,
    private readonly wake: (prompt: string) => Promise<void>,
  ) {}

  async *streamCompletion(): AsyncIterable<CompletionChunk> {
    yield* [] as CompletionChunk[];
    throw new ModelAdapterError(
      "MODEL_UNAVAILABLE",
      "The critic CLI cannot provide autocomplete.",
    );
  }

  async critique(
    input: CriticInput,
    signal: AbortSignal,
    contextProvider?: CriticContextProvider,
  ) {
    return this.coordinator.runCriticTurn(async () => {
      const job = this.broker.enqueue(input, signal, contextProvider);
      try {
        await this.wake(
          "Call openloop_critic_next now. If it returns a claimed job, assess only that job. If the focused text is unclear without neighboring prose, request only the necessary blocks with openloop_critic_context. Then call openloop_critic_submit or openloop_critic_fail with its jobId and leaseToken. Do not edit files or the issue ledger. Stop immediately after the tool result and do not claim another job in this turn.",
        );
      } catch (error) {
        this.broker.cancel(
          job.jobId,
          new ModelAdapterError(
            "MODEL_UNAVAILABLE",
            "The managed critic CLI could not be awakened.",
            { cause: error },
          ),
        );
      }
      return job.result;
    });
  }

  async reconcile(input: ReconcileInput, signal: AbortSignal) {
    return this.coordinator.runCriticTurn(async () => {
      const job = this.broker.enqueueReconciliation(input, signal);
      try {
        await this.wake(
          "Call openloop_reconcile_next now. If it returns a claimed job, decide only whether that existing issue persists, is resolved, is invalidated, or is uncertain from the supplied current and nearby blocks. Then call openloop_reconcile_submit or openloop_reconcile_fail with its jobId and leaseToken. Do not create a new objection or edit files or the issue ledger. Stop immediately after the tool result.",
        );
      } catch (error) {
        this.broker.cancelReconciliation(
          job.jobId,
          new ModelAdapterError(
            "MODEL_UNAVAILABLE",
            "The managed critic CLI could not be awakened for reconciliation.",
            { cause: error },
          ),
        );
      }
      return job.result;
    });
  }
}
