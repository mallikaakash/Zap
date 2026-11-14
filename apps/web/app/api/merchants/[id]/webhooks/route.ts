import { authMerchant, enqueueWebhook, UserError } from "@uc/core";
import { db } from "@uc/db";
import { handle, tokenOf, type Ctx } from "@/lib/api";

/** Recent webhook deliveries and emails for the dashboard. */
export function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    const m = await authMerchant(id, tokenOf(req));
    const rows = await db.webhookDelivery.findMany({ where: { merchantId: id }, orderBy: { createdAt: "desc" }, take: 30 });
    const emails = m.email ? await db.email.findMany({ where: { to: m.email }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
    return {
      deliveries: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, lastError: d.lastError, payload: JSON.parse(d.payload) as unknown, createdAt: d.createdAt.toISOString() })),
      emails: emails.map((e) => ({ id: e.id, subject: e.subject, status: e.status, error: e.error, createdAt: e.createdAt.toISOString() })),
    };
  });
}

/** Queue a signed `webhook.test` event so the seller can check their endpoint and secret before a real payment. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const id = (await params).id;
    const m = await authMerchant(id, tokenOf(req));
    if (!m.webhookUrl) throw new UserError("Set a webhook URL in Settings first.");
    await enqueueWebhook(id, "webhook.test", { message: "Test event from the Zap dashboard. No money moved.", merchant: id });
    return { ok: true };
  });
}
