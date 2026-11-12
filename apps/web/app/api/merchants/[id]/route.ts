import { merchantView, updateMerchant, UserError } from "@uc/core";
import { db } from "@uc/db";
import { body, handle, type Ctx } from "@/lib/api";

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const m = await db.merchant.findUnique({ where: { id: (await params).id } });
    if (!m) throw new UserError("Merchant not found", 404);
    return merchantView(m);
  });
}

export function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => merchantView(await updateMerchant((await params).id, (await body(req)) as never)));
}
