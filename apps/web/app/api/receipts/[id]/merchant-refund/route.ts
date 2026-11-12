import { merchantRefund } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Merchant-initiated refund of unreleased funds; needs no customer key. Body: `{ amount? }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req).catch(() => ({}) as Record<string, unknown>);
    return { receipt: await merchantRefund((await params).id, typeof b.amount === "string" ? b.amount : undefined) };
  });
}
