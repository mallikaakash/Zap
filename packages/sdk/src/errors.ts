export type UcErrorCode = "invalid_config" | "network" | "http" | "bad_response";

/** Every error thrown by the SDK is a UcError with a stable `code`. */
export class UcError extends Error {
  readonly code: UcErrorCode;
  readonly status?: number;

  constructor(code: UcErrorCode, message: string, status?: number) {
    super(message);
    this.name = "UcError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}
