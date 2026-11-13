"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { PayButton } from "@/components/pay-button";
import { CopyButton, Logo, SimBadge } from "@/components/ui";

const POINTS: Array<[string, string]> = [
  ["Any coin, any chain", "Customers pay with what they hold. NEAR Intents swaps it; the shop receives USDC."],
  ["A receipt that holds the money", "Each payment becomes an NFT receipt. The money waits in a public contract, not with the shop, until the refund period ends."],
  ["Refunds back to where they came from", "Same coin, same chain. A refund assistant answers first, within limits the shop sets and the contract enforces."],
  ["Passes and milestones", "Prepaid subscriptions and schedules release over time. Cancel and the rest comes back. Passes can change hands."],
];

export default function Home() {
  const [origin, setOrigin] = useState("https://your-checkout-host");
  const [merchant, setMerchant] = useState<string | null>(null);
  const [mode, setMode] = useState<string | undefined>();
  useEffect(() => {
    setOrigin(window.location.origin);
    api<{ merchants: Array<{ id: string }> }>("/api/merchants").then((r) => setMerchant(r.merchants[0]?.id ?? null)).catch(() => {});
    api<{ mode: string }>("/api/dev/state").then((r) => setMode(r.mode)).catch(() => {});
  }, []);
  const snippet = `<script src="${origin}/pay.js" defer></script>\n<pay-button merchant="${merchant ?? "your-shop.near"}" amount="1" product="Test purchase"></pay-button>`;

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <header className="flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <SimBadge mode={mode} />
          <a className="btn-ghost" href="/shop">Demo shop</a>
          <a className="btn-primary" href={merchant ? `/dashboard?m=${merchant}` : "/dashboard"}>Merchant dashboard</a>
        </nav>
      </header>

      <section className="grid items-center gap-10 py-16 md:grid-cols-2">
        <div>
          <h1 className="text-4xl leading-tight font-semibold tracking-tight md:text-5xl">One button for every way money moves.</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">Add two lines to any website. Customers pay in any coin on any chain, you get USDC, and every payment is a receipt that holds the money until the refund period ends.</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {merchant ? <PayButton merchant={merchant} amount="1" product="Test purchase" label="Try it: pay $1" /> : null}
            <a className="btn-ghost" href="/shop">See it in a shop</a>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-xs font-semibold tracking-wide text-muted uppercase">Your whole integration</span>
            <CopyButton text={snippet} label="Copy" className="text-xs font-semibold text-accent hover:underline" />
          </div>
          <pre className="mono overflow-x-auto bg-slate-950 p-4 text-[13px] leading-relaxed text-slate-100">{snippet}</pre>
          <p className="px-4 py-3 text-xs leading-relaxed text-muted">
            No backend needed to take a payment. To fulfil orders, verify our signed webhook on your server: the button alone is never proof of payment.
          </p>
        </div>
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-2">
        {POINTS.map(([title, body]) => (
          <div key={title} className="card p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-line py-6 text-xs leading-relaxed text-muted">
        Built at NEAR HACKATHON 2026. Hackathon prototype, unaudited, not a licensed money service. Funds are held by a public contract, not by a company.
      </footer>
    </main>
  );
}
