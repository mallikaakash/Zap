import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@uc/db";

export type WebhookEvent =
  | "payment.succeeded"
  | "receipt.released"
  | "refund.requested"
  | "refund.executed"
  | "subscription.cancelled";

/** `sha256=<hex HMAC-SHA256(secret, body)>` — the value of the `X-UC-Signature` header. */
export function signWebhook(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Constant-time check a merchant server should run on every webhook. */
export function verifyWebhook(secret: string, body: string, signature: string): boolean {
  const expected = Buffer.from(signWebhook(secret, body));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Queue a webhook. The settlement worker delivers it (with retries). */
export async function enqueueWebhook(merchantId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) return;
  const payload = JSON.stringify({ event, createdAt: new Date().toISOString(), data });
  await db.webhookDelivery.create({
    data: {
      merchantId,
      event,
      payload,
      signature: signWebhook(merchant.webhookSecret, payload),
      status: merchant.webhookUrl ? "pending" : "skipped",
    },
  });
}

const MAX_ATTEMPTS = 5;

/** Deliver pending webhooks once. Returns how many were delivered. */
export async function deliverPendingWebhooks(fetchImpl: typeof fetch = fetch): Promise<number> {
  const pending = await db.webhookDelivery.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 20 });
  let delivered = 0;
  for (const d of pending) {
    const merchant = await db.merchant.findUnique({ where: { id: d.merchantId } });
    if (!merchant?.webhookUrl) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "skipped" } });
      continue;
    }
    try {
      const res = await fetchImpl(merchant.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-uc-signature": d.signature, "x-uc-event": d.event, "x-uc-delivery": d.id },
        body: d.payload,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "delivered", attempts: d.attempts + 1, lastError: null } });
      delivered++;
    } catch (e) {
      const attempts = d.attempts + 1;
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { attempts, lastError: String(e instanceof Error ? e.message : e), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" },
      });
    }
  }
  return delivered;
}
