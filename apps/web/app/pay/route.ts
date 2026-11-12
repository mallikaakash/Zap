import { NextResponse } from "next/server";
import { checkoutUrl, createSession } from "@uc/core";
import { buildSessionBody } from "@uc/sdk";

/**
 * Payment links and QR codes: `/pay?merchant=…&amount=49&product=Ebook&mode=one-time`.
 * Creates a session and sends the customer to the hosted checkout.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const get = (k: string) => q.get(k) ?? undefined;
    const sessionBody = buildSessionBody({
      merchant: get("merchant") ?? "",
      amount: get("amount"),
      product: get("product"),
      mode: (get("mode") ?? "one-time") as never,
      months: get("months"),
      monthly: get("monthly"),
      tranches: get("tranches"),
      orderRef: get("orderRef"),
      metadata: get("metadata"),
    } as never);
    const s = await createSession(sessionBody as never);
    return NextResponse.redirect(checkoutUrl(s.id), 303);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid payment link";
    return new NextResponse(`This payment link is not valid: ${message}`, { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
