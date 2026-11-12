import { merchantView, publicMerchantView, registerMerchant } from "@uc/core";
import { db } from "@uc/db";
import { body, handle } from "@/lib/api";

export function GET() {
  return handle(async () => ({ merchants: (await db.merchant.findMany({ orderBy: { createdAt: "asc" } })).map(publicMerchantView) }));
}

export function POST(req: Request) {
  return handle(async () => merchantView(await registerMerchant((await body(req)) as never)));
}
