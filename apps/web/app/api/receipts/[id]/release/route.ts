import { collectPayout } from "@uc/core";
import { handle, type Ctx } from "@/lib/api";

/** "Collect payout": ask the contract to release money that is already due. Open to anyone; the contract enforces the rules. */
export function POST(_req: Request, { params }: Ctx) {
  return handle(async () => collectPayout((await params).id));
}
