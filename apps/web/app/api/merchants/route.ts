import { merchantView, publicMerchantView, registerMerchant } from "@uc/core";
import { db } from "@uc/db";
import { body, handle } from "@/lib/api";

/** Public list of shops (names only). */
export function GET() {
  return handle(async () => ({ merchants: (await db.merchant.findMany({ orderBy: { createdAt: "asc" } })).map(publicMerchantView) }));
}

/** Seller sign-up: `{ name, email, payoutAccount }`. Returns the private dashboard link once. */
export function POST(req: Request) {
  return handle(async () => merchantView(await registerMerchant((await body(req)) as never)));
}
