import { confirmReceived, parseAuth } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Customer confirms the order arrived: the merchant can be paid at once. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => ({ receipt: await confirmReceived((await params).id, parseAuth(await body(req))) }));
}
