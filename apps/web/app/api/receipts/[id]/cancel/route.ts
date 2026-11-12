import { openRequest, parseAuth } from "@uc/core";
import { body, handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

/** Cancel a subscription/schedule: tranches not yet due become a refund request. Body: `{ reason, sig }` or `{ reason, owner }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return openRequest((await params).id, "cancel", { reason: String(b.reason ?? ""), auth: parseAuth(b) });
  });
}
