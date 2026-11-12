import { cancelReceipt, parseAuth } from "@uc/core";
import { body, handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const res = await cancelReceipt((await params).id, parseAuth(await body(req)));
    return { needsApproval: res.needsApproval, receipt: res.receipt };
  });
}
