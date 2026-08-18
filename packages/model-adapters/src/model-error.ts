export type ModelErrorCode =
  | "MODEL_TIMEOUT"
  | "MODEL_ABORTED"
  | "MODEL_RATE_LIMITED"
  | "MODEL_MALFORMED_OUTPUT"
  | "MODEL_UNAVAILABLE";

export class ModelAdapterError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ModelAdapterError";
  }
}
