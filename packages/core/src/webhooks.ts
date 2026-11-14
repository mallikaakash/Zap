import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@uc/db";

export type WebhookEvent =
  | "payment.succeeded"
  | "receipt.released"
  | "refund.requested"
  | "refund.escalated"
  | "refund.approved"
  | "refund.rejected"
  | "refund.executed"
  | "subscription.cancelled"
  | "webhook.test"; // sent from the dashboard to check the endpoint and secret; no money involved

/** Events older than this are rejected by `verifyWebhook` (replay protection). */
export const WEBHOOK_TOLERANCE_SECS = 300;

/** `sha256=<hex HMAC-SHA256(secret, "${timestamp}.${body}")>` — the `X-UC-Signature` header. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * What every merchant server must run on each webhook: constant-time signature check
 * over `timestamp.body`, and reject anything older than five minutes. Use the body's
 * `id` to ignore duplicates (deliveries are retried).
 */
export function verifyWebhook(secret: string, body: string, signature: string, timestamp: string | number, nowSecs = Math.floor(Date.now() / 1000)): boolean {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSecs - ts) > WEBHOOK_TOLERANCE_SECS) return false;
  const expected = Buffer.from(signWebhook(secret, ts, body));
  const got = Buffer.from(String(signature));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Queue a webhook. The settlement worker delivers it, with retries and backoff. */
export async function enqueueWebhook(merchantId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) return;
  const payload = JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, "")}`, event, createdAt: new Date().toISOString(), data });
  await db.webhookDelivery.create({
    data: { merchantId, event, payload, timestamp: 0, signature: "", status: merchant.webhookUrl ? "pending" : "skipped" },
  });
}

const MAX_ATTEMPTS = 6;
/** Seconds to wait before attempt n+1. */
const BACKOFF = [0, 5, 30, 120, 600, 1800];

/** Deliver due webhooks once. Each attempt is signed afresh so its timestamp is current. */
export async function deliverPendingWebhooks(fetchImpl: typeof fetch = fetch): Promise<number> {
  const pending = await db.webhookDelivery.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 20 });
  let delivered = 0;
  for (const d of pending) {
    const wait = (BACKOFF[d.attempts] ?? 1800) * 1000;
    if (d.attempts > 0 && Date.now() - d.updatedAt.getTime() < wait) continue;
    const merchant = await db.merchant.findUnique({ where: { id: d.merchantId } });
    if (!merchant?.webhookUrl) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "skipped" } });
      continue;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signWebhook(merchant.webhookSecret, timestamp, d.payload);
    const eventId = (JSON.parse(d.payload) as { id?: string }).id ?? d.id;
    try {
      const res = await fetchImpl(merchant.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-uc-signature": signature, "x-uc-timestamp": String(timestamp), "x-uc-event": d.event, "x-uc-event-id": eventId },
        body: d.payload,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "delivered", attempts: d.attempts + 1, lastError: null, timestamp, signature } });
      delivered++;
    } catch (e) {
      const attempts = d.attempts + 1;
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { attempts, timestamp, signature, lastError: String(e instanceof Error ? e.message : e), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" },
      });
    }
  }
  return delivered;
}
