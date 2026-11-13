import { authMerchant, merchantDecide, mustGet } from "@uc/core";
import { body, handle, tokenOf, type Ctx } from "@/lib/api";

/** Seller decision from the dashboard (signed on chain by our relayer on the seller's behalf). Body: `{ note? }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    await authMerchant((await mustGet(id)).merchantId, tokenOf(req));
    const b = await body(req).catch(() => ({}) as Record<string, unknown>);
    return { receipt: await merchantDecide(id, "veto", typeof b.note === "string" ? b.note : "") };
  });
}
