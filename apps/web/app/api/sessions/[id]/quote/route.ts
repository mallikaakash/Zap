import { quoteSession, sessionView } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

export function POST(req: Request, { params }: Ctx) {
  return handle(async () => sessionView(await quoteSession((await params).id, (await body(req)) as never)));
}
