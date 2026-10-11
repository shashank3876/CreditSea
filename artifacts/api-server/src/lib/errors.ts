export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "REQUEST_FAILED",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
