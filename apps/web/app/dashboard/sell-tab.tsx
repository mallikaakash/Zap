"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, duration, toMinor, usd } from "@/lib/client";
import { agentPrompt, buttonAttrs, integrationSteps, PLATFORMS, type Platform } from "@/lib/integrate";
import { PayButton } from "@/components/pay-button";
import { CopyButton, DurationInput, Field, Notice, QR, Spinner, usePoll } from "@/components/ui";

export interface SellMerchant {
  id: string;
  name: string;
  defaultWindowSecs: number;
  productsOnly: boolean;
  button: { label?: string; color?: string; radius?: string; size?: string; icon?: string };
}

export interface Product {
  id: string;
  name: string;
  description: string;
  emoji: string;
  amount: string;
  kind: "OneTime" | "Subscription" | "Schedule";
  schedule: Array<{ afterSecs: number; amount: string }>;
  windowSecs: number | null;
}

const CUSTOM = "custom";
const DEFAULT_STYLE = { label: "Pay any way", color: "#111111", radius: "12", size: "md", icon: "lock" };

function priceLine(p: Product, m: SellMerchant): string {
  if (p.kind === "Subscription") return `${p.schedule.length} × ${usd(p.schedule[0]?.amount)} every ${duration(p.schedule[1]?.afterSecs ?? 0)}`;
  return `${usd(p.amount)} · refund window ${duration(p.windowSecs ?? m.defaultWindowSecs)}`;
}

function StepCard({ n, title, right, children }: { n: number; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-semibold">
          <span className="mono grid h-6 w-6 place-items-center rounded-full bg-ink text-xs text-white">{n}</span>
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function SellTab({ m, onSaved, goSettings }: { m: SellMerchant; onSaved: () => void; goSettings: () => void }) {
  const { data, refresh } = usePoll(() => api<{ products: Product[] }>(`/api/merchants/${m.id}/products`), 15000, [m.id]);
  const products = data?.products ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState({ product: "Ebook", amount: "49" });
  const [b, setB] = useState({ ...DEFAULT_STYLE, ...Object.fromEntries(Object.entries(m.button).filter(([, v]) => v)) } as typeof DEFAULT_STYLE);
  const [saved, setSaved] = useState(false);
  const [platform, setPlatform] = useState<Platform>("html");
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  // Default to the first saved product; fall back to a custom price only when there is none.
  useEffect(() => {
    if (!data) return;
    if (pick && (pick === CUSTOM || products.some((p) => p.id === pick))) return;
    setPick(products[0]?.id ?? (m.productsOnly ? null : CUSTOM));
    if (products.length === 0) setAdding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const product = products.find((p) => p.id === pick) ?? null;
  const isCustom = pick === CUSTOM;
  const customOk = toMinor(custom.amount) !== null && custom.amount.trim() !== "" && BigInt(toMinor(custom.amount)!) > 0n;
  const ready = !!product || (isCustom && customOk);

  const style = {
    label: b.label !== DEFAULT_STYLE.label ? b.label : undefined,
    color: b.color.toLowerCase() !== DEFAULT_STYLE.color ? b.color : undefined,
    radius: b.radius !== DEFAULT_STYLE.radius ? b.radius : undefined,
    size: b.size !== DEFAULT_STYLE.size ? b.size : undefined,
    icon: b.icon !== DEFAULT_STYLE.icon ? b.icon : undefined,
  };
  const attrs = product
    ? buttonAttrs({ merchant: m.id, "product-id": product.id, ...style })
    : buttonAttrs({ merchant: m.id, amount: custom.amount.trim(), product: custom.product.trim(), ...style });
  const steps = useMemo(() => integrationSteps(platform, origin, attrs), [platform, origin, attrs]);
  const prompt = agentPrompt({
    origin,
    merchant: m.id,
    shopName: m.name,
    products: products.map((p) => ({ id: p.id, name: p.name, price: p.kind === "Subscription" ? priceLine(p, m) : usd(p.amount) })),
    attrs,
  });
  const link = product
    ? `${origin}/pay?merchant=${encodeURIComponent(m.id)}&product-id=${product.id}`
    : `${origin}/pay?merchant=${encodeURIComponent(m.id)}&amount=${encodeURIComponent(custom.amount)}&product=${encodeURIComponent(custom.product)}&mode=one-time`;
  const set = (k: keyof typeof b) => (e: { target: { value: string } }) => {
    setB({ ...b, [k]: e.target.value });
    setSaved(false);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <StepCard n={1} title="What are you selling?">
          {!data ? (
            <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading products…</p>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="Product for this button">
              {products.map((p) => (
                <Choice key={p.id} on={pick === p.id} onClick={() => setPick(p.id)}>
                  <span className="text-xl" aria-hidden="true">{p.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="block text-xs text-muted">{p.kind === "Subscription" ? "Prepaid pass · " : ""}{priceLine(p, m)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{usd(p.amount)}</span>
                </Choice>
              ))}
              {!m.productsOnly ? (
                <Choice on={isCustom} onClick={() => setPick(CUSTOM)}>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs font-bold text-muted" aria-hidden="true">$</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Custom price</span>
                    <span className="block text-xs text-muted">Price written into the snippet. Quick, but less safe.</span>
                  </span>
                </Choice>
              ) : null}
              {isCustom ? (
                <div className="rise space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Product name"><input className="input" value={custom.product} onChange={(e) => setCustom({ ...custom, product: e.target.value })} /></Field>
                    <Field label="Price (USD)"><input className="input tabular-nums" inputMode="decimal" value={custom.amount} onChange={(e) => setCustom({ ...custom, amount: e.target.value })} aria-invalid={!customOk} /></Field>
                  </div>
                  <p className="text-xs leading-relaxed text-warn">
                    The price is in your page&apos;s HTML, so a buyer could edit it before paying. Use a saved product for anything you fulfil automatically, or <button type="button" className="link text-xs" onClick={goSettings}>accept saved products only</button>.
                  </p>
                </div>
              ) : null}
              <div className="pt-2">
                {adding ? (
                  <AddProduct m={m} onDone={(id) => { setAdding(false); refresh(); if (id) setPick(id); }} onCancel={products.length ? () => setAdding(false) : undefined} />
                ) : (
                  <button type="button" className="btn-ghost w-full" onClick={() => setAdding(true)}>+ Add a product</button>
                )}
              </div>
              {product ? (
                <button type="button" className="text-xs font-semibold text-bad hover:underline" onClick={async () => { await api(`/api/merchants/${m.id}/products`, { method: "DELETE", body: { productId: product.id } }); setPick(null); refresh(); }}>
                  Remove “{product.name}”
                </button>
              ) : null}
            </div>
          )}
        </StepCard>

        <StepCard n={2} title="Style it">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label"><input className="input" value={b.label} onChange={set("label")} maxLength={40} /></Field>
            <Field label="Colour">
              <span className="flex items-center gap-2">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#111111"} onChange={set("color")} className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1" aria-label="Button colour" />
                <input className="input mono" value={b.color} onChange={set("color")} aria-label="Button colour hex" />
              </span>
            </Field>
            <Field label={`Corner radius · ${b.radius}px`}><input type="range" min="0" max="28" value={b.radius} onChange={set("radius")} className="w-full accent-[var(--accent)]" /></Field>
            <Field label="Size"><select className="input" value={b.size} onChange={set("size")}><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option></select></Field>
            <Field label="Icon"><select className="input" value={b.icon} onChange={set("icon")}><option value="lock">Lock</option><option value="coins">Coins</option><option value="none">None</option></select></Field>
          </div>
          <button type="button" className="btn-ghost mt-4" onClick={async () => { await api(`/api/merchants/${m.id}`, { method: "PATCH", body: { button: b } }); setSaved(true); onSaved(); }}>
            {saved ? "Saved" : "Save as my default style"}
          </button>
        </StepCard>
      </div>

      <div className="space-y-5">
        <section className="card p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Preview</h2>
            <span className="pill bg-accent-soft text-muted">Not live · no payment</span>
          </div>
          <div className="mt-4 grid min-h-32 place-items-center rounded-2xl bg-[repeating-conic-gradient(#f4f4f1_0_25%,#fff_0_50%)] bg-[length:20px_20px] p-6 ring-1 ring-line">
            {ready ? (
              <PayButton preview merchant={m.id} productId={product?.id} amount={product ? undefined : custom.amount} product={product ? product.name : custom.product} label={b.label} color={b.color} radius={b.radius} size={b.size} icon={b.icon} />
            ) : (
              <span className="text-sm text-muted">{isCustom ? "Enter a price like 49 or 49.99" : "Add or pick a product first"}</span>
            )}
          </div>
        </section>

        <StepCard n={3} title="Add it to your site">
          {!ready ? (
            <p className="text-sm text-muted">Pick what you&apos;re selling first.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl bg-ink p-4 text-white">
                <p className="font-semibold">Let your AI do it</p>
                <p className="mt-1 text-sm text-white/70">One prompt for Cursor, Claude Code, Lovable or v0. It adds the script, the buttons for your products, and a webhook endpoint that checks our signature.</p>
                <CopyButton text={prompt} label="Copy prompt for your AI" className="btn mt-3 bg-white text-ink hover:bg-[#f1f1ee]" />
              </div>
              <p className="label !mb-2 pt-1">Or add it yourself</p>
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Your platform">
                {PLATFORMS.map((p) => (
                  <button key={p.id} type="button" role="tab" aria-selected={platform === p.id} onClick={() => setPlatform(p.id)} className={`pill ring-1 transition ${platform === p.id ? "bg-ink text-white ring-ink" : "bg-white text-muted ring-line hover:text-ink"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <ol className="space-y-4">
                {steps.map((s, i) => (
                  <li key={`${platform}-${i}`} className="space-y-2">
                    <p className="text-sm leading-relaxed">
                      {steps.length > 1 ? <span className="font-semibold">{i + 1}. </span> : null}
                      {s.title}
                    </p>
                    <div className="overflow-hidden rounded-xl ring-1 ring-[#222]">
                      <div className="flex items-center justify-between bg-[#1b1b1b] px-3 py-1.5">
                        <span className="mono text-[11px] text-white/50">{s.file ?? "snippet"}</span>
                        <CopyButton text={s.code} label="Copy" className="rounded-md px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/10" />
                      </div>
                      <pre className="mono overflow-x-auto bg-[#0e0e0e] p-3.5 text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-[#ededed]">{s.code}</pre>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs leading-relaxed text-muted">The button is never proof of payment. Fulfil orders from our signed webhook on your server (Notifications tab); the webhook says which product-id was paid. No server? Payments also arrive by email and in Orders.</p>
            </div>
          )}
        </StepCard>

        {ready && origin ? (
          <section className="card flex flex-wrap items-center gap-5 p-6">
            <QR value={link} size={112} />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">No website? Share a link or QR code</h2>
              <p className="mono mt-2 rounded-xl border border-line p-2.5 text-xs break-all">{link}</p>
              <div className="mt-2"><CopyButton text={link} label="Copy link" /></div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={`flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3 text-left text-sm transition ${on ? "border-ink bg-surface shadow-[0_0_0_3px_rgba(255,45,135,0.15)]" : "border-line bg-surface hover:bg-canvas"}`}>
      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${on ? "border-ink" : "border-[#c4c4bf]"}`} aria-hidden="true">
        {on ? <span className="h-2 w-2 rounded-full bg-pink" /> : null}
      </span>
      {children}
    </button>
  );
}

function AddProduct({ m, onDone, onCancel }: { m: SellMerchant; onDone: (id?: string) => void; onCancel?: () => void }) {
  const [f, setF] = useState({ kind: "OneTime", name: "", price: "", window: "", periods: "3", interval: "2592000", emoji: "🛍️", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const sub = f.kind === "Subscription";
  async function add(e: FormEvent) {
    e.preventDefault();
    if (toMinor(f.price) === null || !f.price.trim()) return setErr("Enter a price like 49 or 49.99.");
    if ([f.window, f.interval].some((v) => v !== "" && !/^\d+$/.test(v))) return setErr("Times must be positive numbers.");
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id?: string; product?: { id: string } }>(`/api/merchants/${m.id}/products`, {
        body: sub
          ? { kind: "Subscription", name: f.name, emoji: f.emoji, description: f.description, pricePerPeriodUsd: f.price, periods: Number(f.periods), intervalSecs: Number(f.interval) }
          : { kind: "OneTime", name: f.name, emoji: f.emoji, description: f.description, priceUsd: f.price, windowSecs: f.window === "" ? undefined : Number(f.window) },
      });
      onDone(r.id ?? r.product?.id);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not add the product");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="rise space-y-3 rounded-2xl bg-canvas p-4 ring-1 ring-line" onSubmit={add}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">New product</p>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Product type">
          {[["OneTime", "One-time"], ["Subscription", "Prepaid pass"]].map(([k, label]) => (
            <button type="button" key={k} role="radio" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k! })} className={`pill ring-1 ${f.kind === k ? "bg-ink text-white ring-ink" : "bg-white text-muted ring-line"}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[4rem_1fr] gap-3">
        <Field label="Icon"><input className="input text-center" value={f.emoji} onChange={up("emoji")} maxLength={4} /></Field>
        <Field label="Name"><input className="input" value={f.name} onChange={up("name")} placeholder={sub ? "Team plan, 3 months prepaid" : "Pro plan, 1 year"} required /></Field>
      </div>
      <Field label="Description (optional)"><input className="input" value={f.description} onChange={up("description")} maxLength={240} /></Field>
      {sub ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
          <Field label="Price per period (USD)"><input className="input tabular-nums" inputMode="decimal" value={f.price} onChange={up("price")} placeholder="29" /></Field>
          <Field label="Periods"><input className="input tabular-nums" value={f.periods} onChange={up("periods")} /></Field>
          <div className="sm:col-span-2"><Field label="One period every"><DurationInput label="Period" value={f.interval} onChange={(v) => setF({ ...f, interval: v })} /></Field></div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Price (USD)"><input className="input tabular-nums" inputMode="decimal" value={f.price} onChange={up("price")} placeholder="49" /></Field>
          <Field label="Refund window" hint={f.window === "" ? `Empty = your default (${duration(m.defaultWindowSecs)})` : undefined}><DurationInput label="Refund window" value={f.window} allowEmpty onChange={(v) => setF({ ...f, window: v })} /></Field>
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted">{sub ? "The customer prepays every period. One period is released to you each interval; if they cancel, the periods not yet started go back to them." : "The money waits in escrow during the refund window, then is paid out to you."}</p>
      {err ? <Notice tone="bad">{err}</Notice> : null}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !f.name.trim()}>{busy ? <Spinner /> : null} Save product</button>
        {onCancel ? <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button> : null}
      </div>
    </form>
  );
}
