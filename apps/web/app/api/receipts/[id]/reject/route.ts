import { merchantDecide } from "@uc/core";
import { body, handle, type Ctx } from "@/lib/api";

/** Merchant decision, signed by the merchant's approver account. Body: `{ note? }`. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req).catch(() => ({}) as Record<string, unknown>);
    return { receipt: await merchantDecide((await params).id, "reject", typeof b.note === "string" ? b.note : "") };
  });
}
