import {
  ModelAdapterError,
  type CompletionChunk,
  type CriticContextProvider,
  type CriticInput,
  type ModelAdapter,
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
    private readonly wake: () => Promise<void>,
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
        await this.wake();
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

  async reconcile(): Promise<{
    outcome: "uncertain";
    reason: string;
    confidence: number;
  }> {
    throw new ModelAdapterError(
      "MODEL_UNAVAILABLE",
      "CLI reconciliation is not implemented yet.",
    );
  }
}
