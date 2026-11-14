import { merchantView, publicMerchantView, registerMerchant } from "@uc/core";
import { db } from "@uc/db";
import { body, handle, withSession } from "@/lib/api";

/** Public list of shops (names only). */
export function GET() {
  return handle(async () => ({ merchants: (await db.merchant.findMany({ orderBy: { createdAt: "asc" } })).map(publicMerchantView) }));
}

/** Seller sign-up: `{ name, email, payoutAccount, password }`. Signs the seller in and returns the private dashboard link once. */
export async function POST(req: Request) {
  let token: string | null = null;
  const res = await handle(async () => {
    const m = await registerMerchant((await body(req)) as never);
    token = m.dashboardToken;
    return merchantView(m);
  });
  return token ? withSession(res, token) : res;
}
