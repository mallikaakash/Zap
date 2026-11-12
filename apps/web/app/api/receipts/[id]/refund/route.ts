import { parseAuth, requestRefund } from "@uc/core";
import { body, handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

/** Body: `{ amount?, secret, nextSecretHash }` (unclaimed receipt) or `{ amount?, owner }` (claimed, demo account). */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    const res = await requestRefund((await params).id, typeof b.amount === "string" ? b.amount : undefined, parseAuth(b));
    return { needsApproval: res.needsApproval, receipt: res.receipt };
  });
}
