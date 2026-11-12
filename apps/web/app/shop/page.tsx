"use client";

import { useEffect, useState } from "react";
import { api, fromMinor, usd } from "@/lib/client";
import { PayButton } from "@/components/pay-button";
import { Notice, SimBadge, Spinner } from "@/components/ui";

interface Product {
  id: string;
  name: string;
  description: string;
  emoji: string;
  amount: string;
  kind: "OneTime" | "Subscription" | "Schedule";
  schedule: Array<{ afterSecs: number; amount: string }>;
}

const plain = (minor: string) => fromMinor(minor, 6, 0).replace(/,/g, "");

/** The attributes a merchant would write by hand for each kind of product. */
function buttonAttrs(p: Product) {
  if (p.kind === "Subscription") return { mode: "subscription" as const, months: String(p.schedule.length), monthly: plain(p.schedule[0]?.amount ?? "0") };
  if (p.kind === "Schedule") return { mode: "schedule" as const, tranches: JSON.stringify(p.schedule.map((t) => ({ afterDays: t.afterSecs / 86400, amount: plain(t.amount) }))) };
  return { mode: "one-time" as const, amount: plain(p.amount) };
}

export default function Shop() {
  const [merchant, setMerchant] = useState<{ id: string; name: string } | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [state, setState] = useState<{ mode: string; timeScale: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState<{ name: string; receiptId?: string } | null>(null);

  useEffect(() => {
    (async () => {
      const want = new URLSearchParams(window.location.search).get("m");
      const { merchants } = await api<{ merchants: Array<{ id: string; name: string }> }>("/api/merchants");
      const m = merchants.find((x) => x.id === want) ?? merchants[0];
      if (!m) throw new Error("No shop has been set up yet. Create one in the merchant dashboard.");
      setMerchant(m);
      setProducts((await api<{ products: Product[] }>(`/api/merchants/${m.id}/products`)).products);
      setState(await api("/api/dev/state"));
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the shop"));
  }, []);

  return (
    <div className="min-h-screen bg-[#fbfaf7]">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <a href="/shop" className="text-lg font-semibold tracking-tight">☕ {merchant?.name ?? "Demo Shop"}</a>
          <nav className="flex items-center gap-4 text-sm text-stone-600">
            <SimBadge mode={state?.mode} />
            <a className="hover:text-stone-900" href={merchant ? `/dashboard?m=${merchant.id}` : "/dashboard"}>Merchant dashboard</a>
            <a className="hover:text-stone-900" href="/">About</a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">Small-batch coffee gear</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          An ordinary shop page. Each button below is one <code className="mono text-sm">&lt;pay-button&gt;</code> tag. Pay with any coin on any chain; the shop receives USDC, and your money waits in a receipt you control until the refund period ends.
        </p>
        {state && state.timeScale > 1 ? <p className="mt-2 text-sm text-amber-800">Demo clock: schedule time is compressed, so “one month” passes in about {Math.round((30 * 86400) / state.timeScale)} seconds.</p> : null}

        {error ? <div className="mt-6"><Notice tone="bad">{error}</Notice></div> : null}
        {paid ? (
          <div className="mt-6">
            <Notice tone="good">
              Thanks! The shop was told about your payment for <strong>{paid.name}</strong> by a signed webhook{paid.receiptId ? ` (receipt #${paid.receiptId})` : ""}. Your receipt link is in the checkout window; keep it.
            </Notice>
          </div>
        ) : null}

        {!products && !error ? <p className="mt-8 flex items-center gap-2 text-sm text-stone-500"><Spinner /> Loading products…</p> : null}
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {(products ?? []).map((p) => (
            <article key={p.id} className="flex flex-col rounded-2xl border border-stone-200 bg-white p-5">
              <div className="grid h-32 place-items-center rounded-xl bg-stone-100 text-5xl" aria-hidden="true">{p.emoji}</div>
              <h2 className="mt-4 font-semibold">{p.name}</h2>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-stone-600">{p.description}</p>
              <p className="mt-3 text-lg font-semibold tabular-nums">
                {usd(p.amount)}
                {p.kind === "Subscription" ? <span className="text-sm font-normal text-stone-500"> · {p.schedule.length} × {usd(p.schedule[0]?.amount)}</span> : null}
                {p.kind === "Schedule" ? <span className="text-sm font-normal text-stone-500"> · {p.schedule.length} milestones</span> : null}
              </p>
              <div className="mt-4">
                {merchant ? <PayButton merchant={merchant.id} product={p.name} label="Pay any way" {...buttonAttrs(p)} onPaid={(d) => setPaid({ name: p.name, receiptId: d.receiptId })} /> : null}
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
