import { authMerchant, merchantReceipts } from "@uc/core";
import { handle, tokenOf, type Ctx } from "@/lib/api";

export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    await authMerchant(id, tokenOf(req));
    return merchantReceipts(id);
  });
}
