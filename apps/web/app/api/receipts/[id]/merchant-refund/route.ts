import { authMerchant, merchantRefund, mustGet } from "@uc/core";
import { body, handle, tokenOf, type Ctx } from "@/lib/api";

/** Seller-initiated refund of unreleased funds; needs no customer key. Body: `{ amount? }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    await authMerchant((await mustGet(id)).merchantId, tokenOf(req));
    const b = await body(req).catch(() => ({}) as Record<string, unknown>);
    return { receipt: await merchantRefund(id, typeof b.amount === "string" ? b.amount : undefined) };
  });
}
