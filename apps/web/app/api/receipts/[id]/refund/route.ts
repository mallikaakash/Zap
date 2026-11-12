import { openRequest, parseAuth } from "@uc/core";
import { body, handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

/**
 * Open a refund request on a one-time receipt. Body: `{ reason, amount?, imageName?, sig }` where `sig` is the
 * receipt-key signature of `request_refund` (amount + sha256(reason)), made in the browser — or `{ ..., owner }`
 * for a claimed receipt held by a demo account. The server only relays; it never sees the private key.
 */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return openRequest((await params).id, "refund", { reason: String(b.reason ?? ""), amount: typeof b.amount === "string" ? b.amount : undefined, imageName: typeof b.imageName === "string" ? b.imageName : undefined, auth: parseAuth(b) });
  });
}
