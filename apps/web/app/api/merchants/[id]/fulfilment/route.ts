import { setFulfilment } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Body: `{ orderRef, status: "none"|"shipped"|"delivered"|"digital_accessed", trackingUrl? }`. The refund agent reads this. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return setFulfilment((await params).id, String(b.orderRef ?? ""), String(b.status ?? ""), typeof b.trackingUrl === "string" ? b.trackingUrl : undefined);
  });
}
