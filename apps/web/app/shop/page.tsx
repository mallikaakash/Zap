"use client";

import { useCallback, useEffect, useState } from "react";
import { api, duration, usd } from "@/lib/client";
import { PayButton } from "@/components/pay-button";
import { Logo, Notice, SimBadge, Spinner } from "@/components/ui";

interface Product {
  id: string;
  name: string;
  description: string;
  emoji: string;
  amount: string;
  kind: "OneTime" | "Subscription" | "Schedule";
  schedule: Array<{ afterSecs: number; amount: string }>;
  windowSecs: number | null;
}

type Load =
  | { s: "loading" }
  | { s: "no-shop" }
  | { s: "error"; message: string }
  | { s: "ready"; merchant: { id: string; name: string }; products: Product[] };

const TIMEOUT_MS = 15_000;

/** Fail instead of spinning forever when the server is slow or unreachable. */
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("The demo checkout took too long to answer.")), TIMEOUT_MS))]);
}

export default function Shop() {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [mode, setMode] = useState<string>();
  const [paid, setPaid] = useState<{ name: string; receiptId?: string } | null>(null);

  const fetchShop = useCallback(() => {
    setLoad({ s: "loading" });
    withTimeout(
      (async (): Promise<Load> => {
        const want = new URLSearchParams(window.location.search).get("m");
        const { merchants } = await api<{ merchants: Array<{ id: string; name: string }> }>("/api/merchants");
        const m = merchants.find((x) => x.id === want) ?? merchants[0];
        if (!m) return { s: "no-shop" };
        const { products } = await api<{ products: Product[] }>(`/api/merchants/${m.id}/products`);
        return { s: "ready", merchant: m, products };
      })(),
    )
      .then(setLoad)
      .catch((e: unknown) => setLoad({ s: "error", message: e instanceof Error ? e.message : "Could not load the demo checkout." }));
  }, []);

  useEffect(() => {
    fetchShop();
    api<{ mode: string }>("/api/dev/state")
      .then((r) => setMode(r.mode))
      .catch(() => {});
  }, [fetchShop]);

  const merchant = load.s === "ready" ? load.merchant : null;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <a href="/shop" className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              {merchant?.name ?? "Demo checkout"}
            </span>
            <span className="pill bg-accent-soft text-muted">powered by Zap</span>
          </a>
          <nav className="flex flex-wrap items-center gap-4 text-sm text-muted">
            <SimBadge mode={mode} />
            <a className="hover:text-ink" href={merchant ? `/dashboard?m=${merchant.id}` : "/dashboard"}>
              Merchant dashboard
            </a>
            <a className="hover:text-ink" href="/">
              About Zap
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Plans and pricing</h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted">
          An ordinary pricing page. Each button below is one <code className="mono text-sm text-ink">&lt;pay-button&gt;</code> tag. Customers pay with any coin on any chain; the business receives USDC, and the money waits in a receipt the customer controls until the refund period ends.
        </p>

        {paid ? (
          <div className="mt-6">
            <Notice tone="good">
              Thanks! The business was told about your payment for <strong>{paid.name}</strong> by a signed webhook{paid.receiptId ? ` (receipt #${paid.receiptId})` : ""}. Your receipt link is in the checkout window; keep it.
            </Notice>
          </div>
        ) : null}

        {load.s === "loading" ? (
          <div className="mt-8" aria-busy="true">
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Loading products…
            </p>
            <div className="mt-4 grid gap-5 md:grid-cols-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="card h-72 animate-pulse bg-accent-soft" />
              ))}
            </div>
          </div>
        ) : null}

        {load.s === "no-shop" ? (
          <div className="card mt-8 max-w-xl p-6">
            <Logo />
            <h2 className="mt-5 text-xl font-bold">No merchant is set up on this server yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">This demo checkout shows the first merchant registered here. Create one in the merchant dashboard: it takes a minute, and you can add a product and a pass straight away.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a className="btn-primary" href="/dashboard">
                Set up a merchant account
              </a>
              <a className="btn-ghost" href="/">
                Back to Zap
              </a>
            </div>
          </div>
        ) : null}

        {load.s === "error" ? (
          <div className="mt-8 max-w-xl space-y-3">
            <Notice tone="bad">{load.message}</Notice>
            <button type="button" className="btn-ghost" onClick={fetchShop}>
              Try again
            </button>
          </div>
        ) : null}

        {load.s === "ready" && load.products.length === 0 ? (
          <div className="card mt-8 max-w-xl p-6">
            <h2 className="text-xl font-bold">{load.merchant.name} has no plans or products yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">Plans and products are added in the merchant dashboard, under Products. A one-time plan and a prepaid plan are enough to try every flow.</p>
            <a className="btn-primary mt-5" href={`/dashboard?m=${load.merchant.id}`}>
              Open the dashboard
            </a>
          </div>
        ) : null}

        {load.s === "ready" && load.products.length > 0 ? (
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {load.products.map((p) => (
              <article key={p.id} className="card flex flex-col p-5">
                <div className="grid h-32 place-items-center rounded-2xl bg-accent-soft text-5xl" aria-hidden="true">
                  {p.emoji}
                </div>
                <h2 className="mt-4 font-bold">{p.name}</h2>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-muted">{p.description}</p>
                <p className="mt-3 text-lg font-semibold tabular-nums">
                  {usd(p.amount)}
                  {p.kind === "Subscription" ? (
                    <span className="text-sm font-normal text-muted">
                      {" "}
                      · {p.schedule.length} × {usd(p.schedule[0]?.amount)} every {duration(p.schedule[1]?.afterSecs ?? 0)}
                    </span>
                  ) : null}
                  {p.kind === "OneTime" && p.windowSecs !== null ? <span className="text-sm font-normal text-muted"> · {duration(p.windowSecs)} refund window</span> : null}
                  {p.kind === "Schedule" ? <span className="text-sm font-normal text-muted"> · {p.schedule.length} milestones</span> : null}
                </p>
                <div className="mt-4">
                  <PayButton merchant={load.merchant.id} productId={p.id} product={p.name} label="Pay any way" onPaid={(d) => setPaid({ name: p.name, receiptId: d.receiptId })} />
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
