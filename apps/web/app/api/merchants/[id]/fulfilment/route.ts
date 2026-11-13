import { authMerchant, setFulfilment } from "@uc/core";
import { body, handle, tokenOf, type Ctx } from "@/lib/api";

/** Body: `{ orderRef, status: "none"|"shipped"|"delivered"|"digital_accessed", trackingUrl? }`. The refund assistant reads this. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    await authMerchant(id, tokenOf(req));
    const b = await body(req);
    return setFulfilment(id, String(b.orderRef ?? ""), String(b.status ?? ""), typeof b.trackingUrl === "string" ? b.trackingUrl : undefined);
  });
}
