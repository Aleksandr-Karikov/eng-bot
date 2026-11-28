export class ModelRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = "ModelRequestError";
  }
}

export function modelFailureCode(error: unknown): string {
  if (error instanceof ModelRequestError) return error.code;
  if (error instanceof Error) {
    if (error.name === "ZodError") return "invalid_model_shape";
    if (error.name === "AbortError" || error.name === "TimeoutError") return "timeout";
  }
  return "unknown";
}
