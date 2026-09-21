import {
  WritingEvaluatorResponseSchema,
  type CompiledWritingEvaluation,
  type WritingEvaluatorResponse,
} from "@openloop/shared";
import { z } from "zod";

import type { WritingEvaluator } from "./writing-evaluator.js";

export type WritingEvaluatorErrorCode =
  | "EVALUATOR_NOT_CONFIGURED"
  | "EVALUATOR_AUTH"
  | "EVALUATOR_RATE_LIMITED"
  | "EVALUATOR_TIMEOUT"
  | "EVALUATOR_UNAVAILABLE"
  | "EVALUATOR_INVALID_RESPONSE"
  | "EVALUATION_TOO_LARGE";

export class WritingEvaluatorError extends Error {
  constructor(
    readonly code: WritingEvaluatorErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WritingEvaluatorError";
  }
}

export interface TypeSafeWritingEvaluatorConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  allowInsecureLoopback?: boolean;
}

const NativeUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

const NativeResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
  usage: NativeUsageSchema,
});

function isLoopback(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"
  );
}

function systemOneEndpoint(
  baseUrl: string,
  allowInsecureLoopback: boolean,
): string {
  let url: URL;
  try {
    url = new URL(`${baseUrl.replace(/\/+$/, "")}/systemone`);
  } catch (error) {
    throw new WritingEvaluatorError(
      "EVALUATOR_NOT_CONFIGURED",
      "The TypeSafe API URL is invalid.",
      { cause: error },
    );
  }
  if (url.username || url.password) {
    throw new WritingEvaluatorError(
      "EVALUATOR_NOT_CONFIGURED",
      "The TypeSafe API URL must not contain credentials.",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(
      allowInsecureLoopback &&
      url.protocol === "http:" &&
      isLoopback(url.hostname)
    )
  ) {
    throw new WritingEvaluatorError(
      "EVALUATOR_NOT_CONFIGURED",
      "The TypeSafe API URL must use HTTPS.",
    );
  }
  return url.toString();
}

function retryHint(response: Response): string {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return "";
  if (/^\d{1,6}$/.test(raw)) {
    const seconds = Number(raw);
    if (seconds >= 0 && seconds <= 86_400)
      return ` Retry manually after ${seconds} seconds.`;
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    const seconds = Math.ceil((date - Date.now()) / 1_000);
    if (seconds >= 0 && seconds <= 86_400)
      return ` Retry manually after about ${seconds} seconds.`;
  }
  return "";
}

function responseError(response: Response): WritingEvaluatorError {
  if (response.status === 401 || response.status === 403) {
    return new WritingEvaluatorError(
      "EVALUATOR_AUTH",
      "TypeSafe rejected the evaluation credential.",
    );
  }
  if (response.status === 429) {
    return new WritingEvaluatorError(
      "EVALUATOR_RATE_LIMITED",
      `TypeSafe rate-limited the evaluation.${retryHint(response)}`,
    );
  }
  if (response.status === 413) {
    return new WritingEvaluatorError(
      "EVALUATION_TOO_LARGE",
      "TypeSafe rejected the evaluation because its context limit was exceeded.",
    );
  }
  if (response.status === 400 || response.status === 422) {
    return new WritingEvaluatorError(
      "EVALUATOR_INVALID_RESPONSE",
      "TypeSafe rejected the compiled evaluation request.",
    );
  }
  return new WritingEvaluatorError(
    "EVALUATOR_UNAVAILABLE",
    `TypeSafe evaluation is unavailable (HTTP ${response.status}).`,
  );
}

export class TypeSafeWritingEvaluator implements WritingEvaluator {
  readonly providerId = "typesafe" as const;
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly config: TypeSafeWritingEvaluatorConfig) {
    if (!config.apiKey.trim()) {
      throw new WritingEvaluatorError(
        "EVALUATOR_NOT_CONFIGURED",
        "TYPESAFE_API_KEY is required for TypeSafe evaluation.",
      );
    }
    this.endpoint = systemOneEndpoint(
      config.baseUrl,
      config.allowInsecureLoopback ?? false,
    );
    this.fetchImplementation = config.fetchImplementation ?? fetch;
  }

  async evaluate(
    input: CompiledWritingEvaluation,
    externalSignal: AbortSignal,
  ): Promise<WritingEvaluatorResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = (): void => controller.abort(externalSignal.reason);
    if (externalSignal.aborted) abortFromCaller();
    else
      externalSignal.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(input.request),
        redirect: "manual",
        signal: controller.signal,
      });
      if (!response.ok) throw responseError(response);

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (error) {
        throw new WritingEvaluatorError(
          "EVALUATOR_INVALID_RESPONSE",
          "TypeSafe returned malformed JSON.",
          { cause: error },
        );
      }

      try {
        const native = NativeResponseSchema.parse(raw);
        return WritingEvaluatorResponseSchema.parse({
          model: native.model,
          answers: native.answers,
          usage: {
            inputTokens: native.usage.input_tokens,
            outputTokens: native.usage.output_tokens,
          },
        });
      } catch (error) {
        throw new WritingEvaluatorError(
          "EVALUATOR_INVALID_RESPONSE",
          "TypeSafe returned an invalid evaluation response.",
          { cause: error },
        );
      }
    } catch (error) {
      if (error instanceof WritingEvaluatorError) throw error;
      if (timedOut) {
        throw new WritingEvaluatorError(
          "EVALUATOR_TIMEOUT",
          "TypeSafe evaluation timed out; the request may still have been billed.",
          { cause: error },
        );
      }
      if (externalSignal.aborted) {
        throw new WritingEvaluatorError(
          "EVALUATOR_UNAVAILABLE",
          "TypeSafe evaluation was cancelled; the request may still have been billed.",
          { cause: error },
        );
      }
      throw new WritingEvaluatorError(
        "EVALUATOR_UNAVAILABLE",
        "TypeSafe evaluation is unavailable.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      externalSignal.removeEventListener("abort", abortFromCaller);
    }
  }
}
