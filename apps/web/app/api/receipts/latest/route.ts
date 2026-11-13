import { db } from "@uc/db";
import { handle, preflight } from "@/lib/api";

export const OPTIONS = preflight;
export const dynamic = "force-dynamic";

/**
 * Public: the id of the most recently minted receipt, so the landing page can show a
 * real one. Receipts are already public at /verify/<id>; this only saves guessing an id.
 */
export function GET() {
  return handle(async () => {
    const s = await db.session.findFirst({ where: { receiptId: { not: null } }, orderBy: { createdAt: "desc" }, select: { receiptId: true } });
    return { id: s?.receiptId ?? null };
  });
}
