import { openDispute, parseAuth } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Body: `{ message, imageName?, ...auth }`. The AI refund agent decides within the merchant's policy. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return openDispute((await params).id, { message: String(b.message ?? ""), imageName: typeof b.imageName === "string" ? b.imageName : undefined, auth: parseAuth(b) });
  });
}
