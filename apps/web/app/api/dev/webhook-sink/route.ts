import { verifyWebhook } from "@uc/core";
import { db, kvGet, kvSet } from "@uc/db";
import { json } from "@/lib/api";

interface Seen {
  event: string;
  verified: boolean;
  at: string;
  data: unknown;
}

/**
 * The demo shop's own webhook endpoint. It does what every merchant server must do:
 * verify `X-UC-Signature` with the shared secret before trusting the event.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const merchantId = new URL(req.url).searchParams.get("merchant") ?? "";
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  const verified = !!merchant && verifyWebhook(merchant.webhookSecret, raw, req.headers.get("x-uc-signature") ?? "");
  let parsed: { event?: string; data?: unknown } = {};
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    /* recorded as unverified junk below */
  }
  const key = `sink:${merchantId}`;
  const seen = (await kvGet<Seen[]>(key)) ?? [];
  seen.unshift({ event: parsed.event ?? "unknown", verified, at: new Date().toISOString(), data: parsed.data ?? null });
  await kvSet(key, seen.slice(0, 30));
  return verified ? json({ ok: true }) : json({ error: "bad signature" }, 401);
}

export async function GET(req: Request) {
  const merchantId = new URL(req.url).searchParams.get("merchant") ?? "";
  return json({ received: (await kvGet<Seen[]>(`sink:${merchantId}`)) ?? [] });
}
