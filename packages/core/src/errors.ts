/** An error whose message is safe to show to the caller, with an HTTP status. */
export class UserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "UserError";
  }
}
