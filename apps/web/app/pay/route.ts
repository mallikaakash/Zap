import { NextResponse } from "next/server";
import { checkoutUrl, createSession } from "@uc/core";
import { buildSessionBody } from "@uc/sdk";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A small, self-contained page (no app bundle) in the Zap look, for links that can't become a checkout. */
function invalidLinkPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>This payment link isn't valid · Zap</title>
<style>
:root{color-scheme:light dark;--bg:#fafaf8;--card:#fff;--fg:#111;--muted:#5c5c5c;--line:#e4e4e0;--pink:#ff2d87}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0b;--card:#161616;--fg:#f2f2ee;--muted:#a6a6a2;--line:#2c2c2c}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:520px;background:var(--card);border:1.5px solid var(--line);border-radius:24px;padding:28px}
.mark{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:20px;letter-spacing:-.02em;color:var(--fg);text-decoration:none;background:none;min-height:0;padding:0}
.pill{border:1.5px solid currentColor;border-radius:99px;padding:1px 8px;font-size:9.5px;letter-spacing:.18em;font-weight:600}
h1{margin:22px 0 8px;font-size:26px;line-height:1.15;letter-spacing:-.03em}
p{margin:0 0 10px;color:var(--muted)}
code{display:block;margin:14px 0 18px;padding:12px 14px;border-radius:12px;background:var(--bg);border:1px solid var(--line);color:var(--fg);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
a{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:999px;background:var(--fg);color:var(--bg);font-weight:600;text-decoration:none}
a:focus-visible{outline:2.5px solid var(--pink);outline-offset:2px}
</style></head><body><main>
<a class="mark" href="/" aria-label="Zap Payments home"><img src="/brand/mark.png" width="32" height="32" alt="">Zap<span class="pill">PAYMENTS</span></a>
<h1>This payment link isn't valid</h1>
<p>Nothing was charged. The business that sent you this link needs to fix it; let them know what went wrong:</p>
<code>${esc(message)}</code>
<a href="/">Go to Zap</a>
</main></body></html>`;
}

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
      productId: get("product-id") ?? get("productId"),
      metadata: get("metadata"),
    } as never);
    const s = await createSession(sessionBody as never);
    return NextResponse.redirect(checkoutUrl(s.id), 303);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid payment link";
    return new NextResponse(invalidLinkPage(message), { status: 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
}
