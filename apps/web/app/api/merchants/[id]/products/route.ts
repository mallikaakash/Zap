import { authMerchant, toMinor, UserError } from "@uc/core";
import { db } from "@uc/db";
import { body, handle, preflight, tokenOf, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

const view = (p: { id: string; name: string; description: string; emoji: string; amount: string; kind: string; scheduleJson: string; windowSecs: number | null }) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  emoji: p.emoji,
  amount: p.amount,
  kind: p.kind,
  schedule: JSON.parse(p.scheduleJson) as Array<{ afterSecs: number; amount: string }>,
  windowSecs: p.windowSecs,
});

/** Public: the shop's products. */
export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => ({ products: (await db.product.findMany({ where: { merchantId: (await params).id, active: true }, orderBy: { createdAt: "asc" } })).map(view) }));
}

const money = (v: unknown, what: string): string => {
  let m: string;
  try {
    m = toMinor(String(v ?? ""));
  } catch {
    throw new UserError(`Enter ${what} like 2 or 2.50`);
  }
  if (BigInt(m) <= 0n) throw new UserError(`${what[0]!.toUpperCase()}${what.slice(1)} must be above zero`);
  return m;
};

/**
 * Seller adds a product. Body:
 *   one-time:      `{ name, kind: "OneTime", priceUsd, windowSecs?, description?, emoji? }`
 *   subscription:  `{ name, kind: "Subscription", pricePerPeriodUsd, periods, intervalSecs, description?, emoji? }`
 * Intervals are real time; for a live demo use minutes (e.g. 180).
 */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const merchantId = (await params).id;
    await authMerchant(merchantId, tokenOf(req));
    const b = await body(req);
    const name = String(b.name ?? "").trim().slice(0, 80);
    if (!name) throw new UserError("Give the product a name");
    const common = { merchantId, name, description: String(b.description ?? "").slice(0, 240), emoji: String(b.emoji ?? "🛍️").slice(0, 8) };
    if (b.kind === "Subscription") {
      const per = money(b.pricePerPeriodUsd, "a price per period");
      const periods = Number(b.periods);
      const interval = Number(b.intervalSecs);
      if (!Number.isInteger(periods) || periods < 2 || periods > 24) throw new UserError("Periods must be between 2 and 24");
      if (!Number.isInteger(interval) || interval < 60 || interval > 366 * 86400) throw new UserError("The interval must be between 60 seconds and a year");
      const schedule = Array.from({ length: periods }, (_, i) => ({ afterSecs: i * interval, amount: per }));
      return view(await db.product.create({ data: { ...common, kind: "Subscription", amount: (BigInt(per) * BigInt(periods)).toString(), scheduleJson: JSON.stringify(schedule) } }));
    }
    const amount = money(b.priceUsd, "a price");
    let windowSecs: number | null = null;
    if (b.windowSecs !== undefined && b.windowSecs !== null && b.windowSecs !== "") {
      windowSecs = Number(b.windowSecs);
      if (!Number.isInteger(windowSecs) || windowSecs < 0 || windowSecs > 365 * 86400) throw new UserError("The refund window must be between 0 seconds and a year");
    }
    return view(await db.product.create({ data: { ...common, kind: "OneTime", amount, windowSecs } }));
  });
}

/** Body: `{ productId }` — hide a product (existing receipts are unaffected). */
export function DELETE(req: Request, { params }: Ctx) {
  return handle(async () => {
    const merchantId = (await params).id;
    await authMerchant(merchantId, tokenOf(req));
    const productId = String((await body(req)).productId ?? "");
    await db.product.updateMany({ where: { id: productId, merchantId }, data: { active: false } });
    return { ok: true };
  });
}
