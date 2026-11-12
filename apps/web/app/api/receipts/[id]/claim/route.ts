import { claimReceipt } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Body: `{ secret, account }`. Moves the receipt NFT to a NEAR account. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    return claimReceipt((await params).id, String(b.secret ?? ""), String(b.account ?? ""));
  });
}
