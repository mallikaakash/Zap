import { sessionView, simulatePayment } from "@uc/core";
import { handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

/** Mock swaps only: pretend the customer sent the coins. Refused in live mode. */
export function POST(_req: Request, { params }: Ctx) {
  return handle(async () => sessionView(await simulatePayment((await params).id)));
}
