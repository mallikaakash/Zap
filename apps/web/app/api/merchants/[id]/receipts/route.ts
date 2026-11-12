import { merchantReceipts } from "@uc/core";
import { handle, type Ctx } from "@/lib/api";

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => merchantReceipts((await params).id));
}
