import { toMinor, UserError } from "@uc/core";
import { db } from "@uc/db";
import { body, handle, preflight, type Ctx } from "@/lib/api";

export const OPTIONS = preflight;

const view = (p: { id: string; name: string; description: string; emoji: string; amount: string; kind: string; scheduleJson: string }) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  emoji: p.emoji,
  amount: p.amount,
  kind: p.kind,
  schedule: JSON.parse(p.scheduleJson) as unknown,
});

export function GET(_req: Request, { params }: Ctx) {
  return handle(async () => ({ products: (await db.product.findMany({ where: { merchantId: (await params).id }, orderBy: { createdAt: "asc" } })).map(view) }));
}

/** Body: `{ name, priceUsd: "49.99", description?, emoji? }` — a one-time product link. */
export function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const b = await body(req);
    const merchantId = (await params).id;
    if (!(await db.merchant.findUnique({ where: { id: merchantId } }))) throw new UserError("Merchant not found", 404);
    const name = String(b.name ?? "").trim().slice(0, 80);
    if (!name) throw new UserError("Give the product a name");
    let amount: string;
    try {
      amount = toMinor(String(b.priceUsd ?? ""));
    } catch {
      throw new UserError("Enter a price like 49 or 49.99");
    }
    if (BigInt(amount) <= 0n) throw new UserError("Price must be above zero");
    return view(await db.product.create({ data: { merchantId, name, amount, kind: "OneTime", description: String(b.description ?? "").slice(0, 200), emoji: String(b.emoji ?? "🛍️").slice(0, 8) } }));
  });
}
