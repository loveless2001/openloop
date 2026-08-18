import { ModelAdapterError } from "./model-error.js";

export interface RequestSignal {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
}

export function requestSignal(
  external: AbortSignal,
  timeoutMs: number,
): RequestSignal {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(external.reason);
  if (external.aborted) abortFromCaller();
  else external.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Model request timed out."));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      external.removeEventListener("abort", abortFromCaller);
    },
  };
}

export function mapRequestError(
  error: unknown,
  signal: RequestSignal,
  external: AbortSignal,
): ModelAdapterError {
  if (error instanceof ModelAdapterError) return error;
  if (signal.didTimeout()) {
    return new ModelAdapterError(
      "MODEL_TIMEOUT",
      "The model request timed out.",
      {
        cause: error,
      },
    );
  }
  if (external.aborted) {
    return new ModelAdapterError(
      "MODEL_ABORTED",
      "The model request was aborted.",
      {
        cause: error,
      },
    );
  }
  return new ModelAdapterError(
    "MODEL_UNAVAILABLE",
    "The model provider is unavailable.",
    {
      cause: error,
    },
  );
}

export function assertSuccessfulResponse(response: Response): void {
  if (response.ok) return;
  if (response.status === 429) {
    throw new ModelAdapterError(
      "MODEL_RATE_LIMITED",
      "The model provider rate-limited the request.",
    );
  }
  throw new ModelAdapterError(
    "MODEL_UNAVAILABLE",
    `The model provider returned HTTP ${response.status}.`,
  );
}
