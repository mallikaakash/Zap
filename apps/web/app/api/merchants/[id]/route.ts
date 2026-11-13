import { authMerchant, merchantView, publicMerchantView, updateMerchant } from "@uc/core";
import { db } from "@uc/db";
import { body, handle, tokenOf, type Ctx } from "@/lib/api";
import { UserError } from "@uc/core";

/** With the dashboard token: full settings. Without: the public view. */
export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    const token = tokenOf(req);
    if (token) return merchantView(await authMerchant(id, token));
    const m = await db.merchant.findUnique({ where: { id } });
    if (!m) throw new UserError("Merchant not found", 404);
    return publicMerchantView(m);
  });
}

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    await authMerchant(id, tokenOf(req));
    return merchantView(await updateMerchant(id, (await body(req)) as never));
  });
}
