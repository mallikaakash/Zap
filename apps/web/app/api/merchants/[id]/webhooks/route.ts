import { db } from "@uc/db";
import { handle, type Ctx } from "@/lib/api";

/** Recent webhook deliveries for the dashboard. */
export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const rows = await db.webhookDelivery.findMany({ where: { merchantId: (await params).id }, orderBy: { createdAt: "desc" }, take: 30 });
    return { deliveries: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, lastError: d.lastError, payload: JSON.parse(d.payload) as unknown, signature: d.signature, createdAt: d.createdAt.toISOString() })) };
  });
}
