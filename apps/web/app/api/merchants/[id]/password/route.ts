import { authMerchant, setMerchantPassword } from "@uc/core";
import { body, handle, tokenOf, type Ctx } from "@/lib/api";

/** Body: `{ password }`. Sets or changes the shop's login password (signed-in sellers only). */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    await authMerchant(id, tokenOf(req));
    await setMerchantPassword(id, (await body(req)).password);
    return { ok: true };
  });
}
