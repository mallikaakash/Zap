import { appealRequest, parseAuth } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Appeal an AI denial (once). The request goes to the merchant. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => ({ receipt: await appealRequest((await params).id, parseAuth(await body(req))) }));
}
