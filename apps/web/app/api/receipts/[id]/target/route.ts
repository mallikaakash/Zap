import { parseAuth, setRefundTarget } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Fix a wrong refund address. Body: `{ target: { chain, asset, address }, sig }` or `{ target, owner }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return { receipt: await setRefundTarget((await params).id, b.target as never, parseAuth(b)) };
  });
}
