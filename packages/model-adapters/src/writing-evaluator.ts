import type {
  CompiledWritingEvaluation,
  WritingEvaluatorResponse,
} from "@openloop/shared";

export interface WritingEvaluator {
  readonly providerId: "mock" | "typesafe";
  evaluate(
    input: CompiledWritingEvaluation,
    signal: AbortSignal,
  ): Promise<WritingEvaluatorResponse>;
}
