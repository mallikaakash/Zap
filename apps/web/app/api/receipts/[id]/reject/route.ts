import { decideRefund } from "@uc/core";
import { handle, type Ctx } from "@/lib/api";

export function POST(_req: Request, { params }: Ctx) {
  return handle(async () => ({ receipt: await decideRefund((await params).id, false) }));
}
