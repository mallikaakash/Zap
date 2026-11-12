"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, chainName, duration, fromMinor, short, toMinor, until, usd } from "@/lib/client";
import { receiptStatus } from "@/lib/labels";
import type { DashReceipt } from "@/lib/types";
import { PayButton } from "@/components/pay-button";
import { CopyButton, Field, Logo, Notice, Pill, QR, SimBadge, Spinner, usePoll } from "@/components/ui";

interface Merchant {
  id: string;
  name: string;
  payoutAccount: string;
  guardThreshold: string;
  defaultWindowSecs: number;
  responseSecs: number;
  dailyRefundCap: string;
  aiTriage: boolean;
  autoApproveMax: string;
  vetoSecs: number;
  minOrder: string;
  webhookUrl: string | null;
  webhookSecret: string;
  policy: { refundableCategories: string[]; requiresPhotoFor: string[]; digitalGoodsRule: string; escalateAlways: boolean; customerReplyHours: number };
  button: { label?: string; color?: string; radius?: string; size?: string; icon?: string };
}
interface Orders {
  chainNow: string;
  onChain: { storageBalance: string; refundedToday: string; receiptCount: number } | null;
  receipts: DashReceipt[];
}
interface DevState {
  mode: string;
  canTimeTravel: boolean;
  timeScale: number;
  chainNow: string;
}

const TABS = ["Orders", "Button", "Settings", "Webhooks"] as const;
type Tab = (typeof TABS)[number];
const CATEGORIES = ["damaged", "not_received", "not_as_described", "changed_mind"];

export default function Dashboard() {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("m")), []);
  if (id === undefined) return null;
  return id ? <MerchantDash id={id} /> : <Onboard />;
}

function Page({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <a href="/"><Logo /></a>
        <div className="flex items-center gap-2 text-sm">{right}</div>
      </header>
      {children}
    </main>
  );
}

function Onboard() {
  const [merchants, setMerchants] = useState<Array<{ id: string; name: string }> | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ merchants: Array<{ id: string; name: string }> }>("/api/merchants").then((r) => setMerchants(r.merchants)).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <Page>
      <div className="mx-auto max-w-md space-y-4">
        <div className="card p-6">
          <h1 className="text-lg font-semibold">Create your shop</h1>
          <p className="mt-1 text-sm text-muted">Registers the shop on the receipt contract with sensible defaults. You can change everything afterwards.</p>
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                const m = await api<Merchant>("/api/merchants", { body: { name } });
                window.location.href = `/dashboard?m=${m.id}`;
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not create the shop");
                setBusy(false);
              }
            }}
          >
            <Field label="Shop name" hint="In this demo the app creates and holds a throwaway NEAR account for the shop. On a hosted deployment you connect your own wallet instead.">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Coffee" minLength={2} maxLength={60} required />
            </Field>
            {error ? <Notice tone="bad">{error}</Notice> : null}
            <button className="btn-primary w-full" disabled={busy}>{busy ? <><Spinner /> Registering on chain…</> : "Create shop"}</button>
          </form>
        </div>
        {merchants && merchants.length > 0 ? (
          <div className="card p-6">
            <h2 className="text-sm font-semibold">Open an existing shop</h2>
            <ul className="mt-2 divide-y divide-line">
              {merchants.map((m) => (
                <li key={m.id}><a className="flex items-center justify-between py-2.5 text-sm hover:text-accent" href={`/dashboard?m=${m.id}`}><span className="font-medium">{m.name}</span><span className="mono text-xs text-muted">{m.id}</span></a></li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Page>
  );
}

function MerchantDash({ id }: { id: string }) {
  const [tab, setTab] = useState<Tab>("Orders");
  const [m, setM] = useState<Merchant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: dev, refresh: refreshDev } = usePoll(() => api<DevState>("/api/dev/state"), 4000);
  const reload = () => api<Merchant>(`/api/merchants/${id}`).then(setM).catch((e: Error) => setError(e.message));
  useEffect(() => void reload(), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Page><Notice tone="bad">{error} <a className="font-semibold underline" href="/dashboard">Choose a shop</a></Notice></Page>;
  if (!m) return <Page><p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading…</p></Page>;
  return (
    <Page right={<><SimBadge mode={dev?.mode} /><a className="btn-ghost" href={`/shop?m=${m.id}`}>View shop</a></>}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{m.name}</h1>
          <p className="mono text-xs text-muted">{m.id}</p>
        </div>
        {dev?.canTimeTravel ? <TimeTravel onDone={refreshDev} /> : null}
      </div>
      <div role="tablist" className="mb-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${tab === t ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Orders" ? <OrdersTab id={id} /> : tab === "Button" ? <ButtonTab m={m} onSaved={reload} /> : tab === "Settings" ? <SettingsTab m={m} onSaved={reload} /> : <WebhooksTab m={m} />}
    </Page>
  );
}

/** Local sandbox only: jump the chain clock so windows and tranches can be shown without waiting. */
function TimeTravel({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (seconds: number) => {
    setBusy(seconds);
    setErr(null);
    try {
      await api("/api/dev/fast-forward", { body: { seconds } });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Time travel failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span className="font-semibold">Sandbox clock</span>
      {[[60, "+1 min"], [600, "+10 min"]].map(([s, label]) => (
        <button key={s} className="rounded-lg bg-white px-2.5 py-1 font-semibold ring-1 ring-amber-200 hover:bg-amber-100 disabled:opacity-50" disabled={busy !== null} onClick={() => go(s as number)}>
          {busy === s ? "…" : label}
        </button>
      ))}
      {err ? <span className="text-bad">{err}</span> : null}
    </div>
  );
}

function OrdersTab({ id }: { id: string }) {
  const { data, error, refresh } = usePoll(() => api<Orders>(`/api/merchants/${id}/receipts`), 2500, [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const act = async (key: string, path: string, body: unknown, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await api(path, { body });
      setMsg({ tone: "good", text: ok });
      refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "That did not work" });
    } finally {
      setBusy(null);
    }
  };

  const totals = useMemo(() => {
    const rs = data?.receipts ?? [];
    const sum = (f: (r: DashReceipt) => bigint) => rs.reduce((a, r) => a + f(r), 0n);
    return { held: sum((r) => BigInt(r.amount) - BigInt(r.released) - BigInt(r.refunded)), released: sum((r) => BigInt(r.released)), refunded: sum((r) => BigInt(r.refunded)), needs: rs.filter((r) => r.request && ["Open", "Escalated", "AiApproved"].includes(r.request.state)).length };
  }, [data]);

  if (error && !data) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Reading receipts from the contract…</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["In escrow", usd(totals.held)], ["Paid out to you", usd(totals.released)], ["Refunded", usd(totals.refunded)], ["Requests needing attention", String(totals.needs)]].map(([k, v]) => (
          <div key={k} className="card px-4 py-3"><p className="text-xs text-muted">{k}</p><p className="mt-0.5 text-xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {data.receipts.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">No orders yet</p>
          <p className="mt-1 text-sm text-muted">Payments appear here as receipts the moment they are minted. Try the button in your shop.</p>
          <a className="btn-primary mt-4" href={`/shop?m=${id}`}>Open the shop</a>
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {data.receipts.map((r) => {
            const st = receiptStatus(r as never);
            const q = r.request;
            const held = BigInt(r.amount) - BigInt(r.released) - BigInt(r.refunded);
            const expanded = open === r.id;
            const decidable = q && (q.state === "Open" || q.state === "Escalated");
            return (
              <div key={r.id} className="p-4">
                <button className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.product ?? "Order"} <span className="font-normal text-muted">· #{r.id}</span></span>
                    <span className="block text-xs text-muted">
                      {r.orderRef ? <span className="mono">{short(r.orderRef, 14, 4)}</span> : "direct payment"} · {r.kind === "OneTime" ? "one-time" : r.kind.toLowerCase()}
                      {r.paidWith?.symbol ? ` · paid in ${r.paidWith.symbol} on ${chainName(r.paidWith.chain)}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Pill tone={st.tone}>{st.label}</Pill>
                    <span className="w-20 text-right font-semibold tabular-nums">{usd(r.amount)}</span>
                  </span>
                </button>

                {decidable || q?.state === "AiApproved" ? (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm">
                    <p className="font-semibold text-amber-900">
                      {q!.isCancel ? "Cancellation" : "Refund"} request for {usd(q!.amount)}
                      {q!.state === "AiApproved" && q!.vetoUntil ? ` · approved by the assistant, pays out in ${until(q!.vetoUntil, data.chainNow)}` : ` · approved automatically in ${until(q!.decisionDeadline, data.chainNow)} if you do nothing`}
                    </p>
                    {r.case?.decision ? (
                      <p className="mt-1.5 leading-relaxed text-amber-950">
                        <span className="font-semibold">Assistant's summary:</span> {r.case.decision.summary} <span className="text-amber-800">(recommendation: {r.case.decision.decision}, confidence {Math.round(r.case.decision.confidence * 100)}%)</span>
                      </p>
                    ) : r.case ? (
                      <p className="mt-1.5 text-amber-950">“{r.case.messages.find((x) => x.role === "customer")?.text}”</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {decidable ? (
                        <>
                          <button className="btn-primary" disabled={busy !== null} onClick={() => act(`a${r.id}`, `/api/receipts/${r.id}/approve`, {}, "Refund approved. It is being sent back to the customer.")}>{busy === `a${r.id}` ? <Spinner /> : null} Approve refund</button>
                          <button className="btn-danger" disabled={busy !== null} onClick={() => act(`r${r.id}`, `/api/receipts/${r.id}/reject`, { note: "Declined by the shop" }, "Request declined. The money stays in escrow until the window ends.")}>{busy === `r${r.id}` ? <Spinner /> : null} Decline</button>
                        </>
                      ) : (
                        <button className="btn-ghost" disabled={busy !== null} onClick={() => act(`v${r.id}`, `/api/receipts/${r.id}/veto`, { note: "Shop asked to review" }, "Paused. The request is now waiting for your decision.")}>{busy === `v${r.id}` ? <Spinner /> : null} Object and review it myself</button>
                      )}
                    </div>
                  </div>
                ) : null}

                {expanded ? (
                  <div className="rise mt-3 space-y-3 border-t border-line pt-3 text-sm">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 md:grid-cols-4">
                      <Meta k="In escrow" v={usd(held)} />
                      <Meta k="Paid out" v={usd(r.released)} />
                      <Meta k="Refunded" v={usd(r.refunded)} />
                      <Meta k={r.kind === "OneTime" ? "Refund window" : "Next release"} v={r.kind === "OneTime" ? (r.confirmed ? "confirmed by customer" : new Date(r.windowEnd) > new Date(data.chainNow) ? `${until(r.windowEnd, data.chainNow)} left` : "ended") : (() => { const n = r.schedule.find((t) => t.state === "Pending"); return n ? (new Date(n.at) <= new Date(data.chainNow) ? "due now" : `in ${until(n.at, data.chainNow)}`) : "none"; })()} />
                      <Meta k="Refunds go to" v={<span className="mono">{short(r.refundTarget.address, 8, 6)}</span>} />
                      <Meta k="Holder" v={r.claimed ? short(r.owner, 12, 6) : "unclaimed link"} />
                    </div>
                    {r.orderRef ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold tracking-wide text-muted uppercase">Fulfilment</span>
                        {["none", "shipped", "delivered", "digital_accessed"].map((s) => (
                          <button key={s} disabled={busy !== null} onClick={() => act(`f${r.id}`, `/api/merchants/${id}/fulfilment`, { orderRef: r.orderRef, status: s }, "Fulfilment status updated. The refund assistant takes it into account.")} className={`pill ring-1 ${r.fulfilment === s ? "bg-accent text-white ring-accent" : "bg-white text-slate-600 ring-line hover:bg-canvas"}`}>
                            {s.replace("_", " ")}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {held > 0n && !(q && ["Open", "AiApproved", "Escalated", "Approved"].includes(q.state)) ? (
                        <button className="btn-ghost" disabled={busy !== null} onClick={() => act(`m${r.id}`, `/api/receipts/${r.id}/merchant-refund`, {}, "Refund started. No customer key was needed.")}>{busy === `m${r.id}` ? <Spinner /> : null} Refund what is in escrow</button>
                      ) : null}
                      <a className="btn-ghost" href={`/verify/${r.id}`}>Verify on chain</a>
                    </div>
                    {r.case ? (
                      <details className="rounded-xl border border-line p-3">
                        <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted uppercase">Conversation ({r.case.messages.length})</summary>
                        <ol className="mt-2 space-y-1.5">
                          {r.case.messages.map((x, i) => (
                            <li key={i} className="leading-relaxed"><span className="font-semibold capitalize">{x.role === "agent" ? "Assistant" : x.role}:</span> {x.text}{x.imageName ? ` 📎 ${x.imageName}` : ""}</li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {data.onChain ? <p className="text-xs text-muted">{data.onChain.receiptCount} receipts on chain · {usd(data.onChain.refundedToday)} refunded today · prepaid receipt storage {fromMinor(data.onChain.storageBalance, 24, 2)} NEAR</p> : null}
    </div>
  );
}

const Meta = ({ k, v }: { k: string; v: ReactNode }) => (
  <div><p className="text-xs text-muted">{k}</p><p className="font-medium">{v}</p></div>
);

function ButtonTab({ m, onSaved }: { m: Merchant; onSaved: () => void }) {
  const [b, setB] = useState({ label: m.button.label ?? "Pay any way", color: m.button.color ?? "#4F46E5", radius: m.button.radius ?? "12", size: m.button.size ?? "md", icon: m.button.icon ?? "lock" });
  const [product, setProduct] = useState("Ebook");
  const [amount, setAmount] = useState("49");
  const [saved, setSaved] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const validAmount = toMinor(amount) !== null && amount.trim() !== "" && BigInt(toMinor(amount)!) > 0n;
  const attrs = [`merchant="${m.id}"`, `amount="${amount}"`, `product="${product.replace(/"/g, "&quot;")}"`, b.label !== "Pay any way" ? `label="${b.label.replace(/"/g, "&quot;")}"` : "", b.color.toLowerCase() !== "#4f46e5" ? `color="${b.color}"` : "", b.radius !== "12" ? `radius="${b.radius}"` : "", b.size !== "md" ? `size="${b.size}"` : "", b.icon !== "lock" ? `icon="${b.icon}"` : ""].filter(Boolean).join(" ");
  const snippet = `<script src="${origin}/pay.js" defer></script>\n<pay-button ${attrs}></pay-button>`;
  const link = `${origin}/pay?merchant=${encodeURIComponent(m.id)}&amount=${encodeURIComponent(amount)}&product=${encodeURIComponent(product)}&mode=one-time`;
  const set = (k: keyof typeof b) => (e: { target: { value: string } }) => { setB({ ...b, [k]: e.target.value }); setSaved(false); };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-4 p-6">
        <h2 className="font-semibold">Style your button</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product"><input className="input" value={product} onChange={(e) => setProduct(e.target.value)} /></Field>
          <Field label="Price (USD)"><input className="input tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!validAmount} /></Field>
          <Field label="Label"><input className="input" value={b.label} onChange={set("label")} maxLength={40} /></Field>
          <Field label="Colour"><span className="flex items-center gap-2"><input type="color" value={b.color} onChange={set("color")} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white p-1" aria-label="Button colour" /><input className="input mono" value={b.color} onChange={set("color")} /></span></Field>
          <Field label={`Corner radius · ${b.radius}px`}><input type="range" min="0" max="28" value={b.radius} onChange={set("radius")} className="w-full accent-[var(--accent)]" /></Field>
          <Field label="Size"><select className="input" value={b.size} onChange={set("size")}><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option></select></Field>
          <Field label="Icon"><select className="input" value={b.icon} onChange={set("icon")}><option value="lock">Lock</option><option value="coins">Coins</option><option value="none">None</option></select></Field>
        </div>
        <button className="btn-ghost" onClick={async () => { await api(`/api/merchants/${m.id}`, { method: "PATCH", body: { button: b } }); setSaved(true); onSaved(); }}>{saved ? "Saved" : "Save as my default style"}</button>
      </div>
      <div className="space-y-5">
        <div className="card p-6">
          <h2 className="font-semibold">Live preview</h2>
          <p className="mt-1 text-sm text-muted">This is the real component. Click it to run a payment.</p>
          <div className="mt-4 grid min-h-28 place-items-center rounded-xl bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:20px_20px] p-6">
            {validAmount ? <PayButton merchant={m.id} amount={amount} product={product} label={b.label} color={b.color} radius={b.radius} size={b.size} icon={b.icon} /> : <span className="text-sm text-bad">Enter a price like 49 or 49.99</span>}
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3"><h2 className="font-semibold">Paste this into your site</h2><CopyButton text={snippet} label="Copy snippet" /></div>
          <pre className="mono overflow-x-auto bg-slate-950 p-4 text-[12.5px] leading-relaxed text-slate-100">{snippet}</pre>
          <p className="px-5 py-3 text-xs leading-relaxed text-muted">Two lines, no backend needed to take the payment. Mark orders as paid only after verifying our signed webhook on your server (see the Webhooks tab).</p>
        </div>
        <div className="card flex flex-wrap items-center gap-5 p-6">
          {validAmount && origin ? <QR value={link} size={120} /> : null}
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Or share a link or QR code</h2>
            <p className="mono mt-2 rounded-xl border border-line p-2.5 text-xs break-all">{link}</p>
            <div className="mt-2"><CopyButton text={link} label="Copy link" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ m, onSaved }: { m: Merchant; onSaved: () => void }) {
  const [f, setF] = useState({
    guard: fromMinor(m.guardThreshold).replace(/,/g, ""),
    auto: fromMinor(m.autoApproveMax).replace(/,/g, ""),
    cap: fromMinor(m.dailyRefundCap).replace(/,/g, ""),
    min: fromMinor(m.minOrder).replace(/,/g, ""),
    window: String(m.defaultWindowSecs),
    response: String(m.responseSecs),
    veto: String(m.vetoSecs),
    payout: m.payoutAccount,
    webhook: m.webhookUrl ?? "",
    ai: m.aiTriage,
    escalateAlways: m.policy.escalateAlways,
    cats: m.policy.refundableCategories,
    photo: m.policy.requiresPhotoFor,
    digital: m.policy.digitalGoodsRule,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const up = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggle = (k: "cats" | "photo", c: string) => setF({ ...f, [k]: f[k].includes(c) ? f[k].filter((x) => x !== c) : [...f[k], c] });
  const secs = (v: string) => (/^\d+$/.test(v) ? duration(Number(v)) : "enter whole seconds");

  async function save() {
    const money = { guardThreshold: toMinor(f.guard), autoApproveMax: toMinor(f.auto), dailyRefundCap: toMinor(f.cap), minOrder: toMinor(f.min) };
    if (Object.values(money).some((v) => v === null)) return setMsg({ tone: "bad", text: "Amounts must look like 20 or 20.50." });
    if (![f.window, f.response, f.veto].every((v) => /^\d+$/.test(v))) return setMsg({ tone: "bad", text: "Time settings must be whole numbers of seconds." });
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/merchants/${m.id}`, {
        method: "PATCH",
        body: { ...money, defaultWindowSecs: Number(f.window), responseSecs: Number(f.response), vetoSecs: Number(f.veto), payoutAccount: f.payout, webhookUrl: f.webhook || null, aiTriage: f.ai, policy: { escalateAlways: f.escalateAlways, refundableCategories: f.cats, requiresPhotoFor: f.photo, digitalGoodsRule: f.digital } },
      });
      setMsg({ tone: "good", text: "Saved. Limits and time windows are now enforced by the contract." });
      onSaved();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-4 p-6">
        <h2 className="font-semibold">Escrow and payouts</h2>
        <Field label="Payout account" hint="Released USDC is sent here."><input className="input mono" value={f.payout} onChange={up("payout")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Refund window (seconds)" hint={`${secs(f.window)}. 0 = pay out at once.`}><input className="input tabular-nums" value={f.window} onChange={up("window")} /></Field>
          <Field label="Minimum order (USD)"><input className="input tabular-nums" value={f.min} onChange={up("min")} /></Field>
          <Field label="Your time to answer (seconds)" hint={`${secs(f.response)}. If you stay silent, the request is approved.`}><input className="input tabular-nums" value={f.response} onChange={up("response")} /></Field>
          <Field label="Daily refund cap (USD)" hint="The executor cannot refund more than this per day."><input className="input tabular-nums" value={f.cap} onChange={up("cap")} /></Field>
        </div>
        <Field label="Webhook URL" hint="We POST signed events here: payment.succeeded, receipt.released, refund.*"><input className="input mono" value={f.webhook} onChange={up("webhook")} placeholder="https://your-site.example/webhooks/checkout" /></Field>
      </div>
      <div className="card space-y-4 p-6">
        <h2 className="font-semibold">Refund assistant</h2>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={f.ai} onChange={(e) => setF({ ...f, ai: e.target.checked })} /><span><span className="font-semibold">Answer refund requests first</span><span className="block text-muted">Asks follow-up questions, approves small clear cases, and hands you a summary for the rest. Off = every request comes straight to you.</span></span></label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="May approve up to (USD)"><input className="input tabular-nums" value={f.auto} onChange={up("auto")} disabled={!f.ai} /></Field>
          <Field label="Always ask me above (USD)" hint="Guard threshold."><input className="input tabular-nums" value={f.guard} onChange={up("guard")} /></Field>
          <Field label="Your objection window (seconds)" hint={`${secs(f.veto)} to object before an approval pays out.`}><input className="input tabular-nums" value={f.veto} onChange={up("veto")} disabled={!f.ai} /></Field>
          <Field label="Digital goods"><select className="input" value={f.digital} onChange={up("digital")} disabled={!f.ai}><option value="no_refund_after_access">No refund once accessed</option><option value="refundable">Refundable</option></select></Field>
        </div>
        <fieldset disabled={!f.ai} className="space-y-2">
          <legend className="label">Reasons it may approve on its own</legend>
          <div className="flex flex-wrap gap-2">{CATEGORIES.map((c) => <button type="button" key={c} onClick={() => toggle("cats", c)} aria-pressed={f.cats.includes(c)} className={`pill ring-1 ${f.cats.includes(c) ? "bg-accent text-white ring-accent" : "bg-white text-slate-600 ring-line"}`}>{c.replace(/_/g, " ")}</button>)}</div>
          <legend className="label pt-2">Needs a photo first</legend>
          <div className="flex flex-wrap gap-2">{CATEGORIES.slice(0, 3).map((c) => <button type="button" key={c} onClick={() => toggle("photo", c)} aria-pressed={f.photo.includes(c)} className={`pill ring-1 ${f.photo.includes(c) ? "bg-accent text-white ring-accent" : "bg-white text-slate-600 ring-line"}`}>{c.replace(/_/g, " ")}</button>)}</div>
        </fieldset>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-[var(--accent)]" checked={f.escalateAlways} onChange={(e) => setF({ ...f, escalateAlways: e.target.checked })} disabled={!f.ai} /> Never decide for me; only gather facts and summarise</label>
        <p className="text-xs leading-relaxed text-muted">These limits are enforced in code and by the contract, not by the AI model's instructions, so a customer cannot talk the assistant past them.</p>
      </div>
      <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? <><Spinner /> Saving on chain…</> : "Save settings"}</button>
        {msg ? <div className="min-w-0 flex-1"><Notice tone={msg.tone}>{msg.text}</Notice></div> : null}
      </div>
    </div>
  );
}

function WebhooksTab({ m }: { m: Merchant }) {
  const { data } = usePoll(() => api<{ deliveries: Array<{ id: string; event: string; status: string; attempts: number; lastError: string | null; createdAt: string }> }>(`/api/merchants/${m.id}/webhooks`), 3000, [m.id]);
  const sample = `// Node — verify before you trust it
const ts  = req.headers["x-uc-timestamp"];
const sig = req.headers["x-uc-signature"];           // "sha256=<hex>"
const expected = "sha256=" + crypto.createHmac("sha256", SECRET)
  .update(ts + "." + rawBody).digest("hex");
const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
if (!fresh || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
  return res.status(401).end();
// then ignore event ids you have already handled (deliveries are retried)`;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card space-y-3 p-6">
        <h2 className="font-semibold">Signing secret</h2>
        <p className="text-sm text-muted">Each event is signed over <span className="mono">timestamp.body</span>. The button on your page is never proof of payment: fulfil an order only after this check passes on your server.</p>
        <div className="flex items-center gap-2"><code className="mono min-w-0 flex-1 truncate rounded-xl border border-line px-3 py-2.5 text-xs">{m.webhookSecret}</code><CopyButton text={m.webhookSecret} /></div>
        <pre className="mono overflow-x-auto rounded-xl bg-slate-950 p-4 text-[12px] leading-relaxed text-slate-100">{sample}</pre>
      </div>
      <div className="card p-6">
        <h2 className="font-semibold">Recent deliveries</h2>
        {!data ? <p className="mt-3 flex items-center gap-2 text-sm text-muted"><Spinner /> Loading…</p> : data.deliveries.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing sent yet. Events appear here after the first payment.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {data.deliveries.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0"><span className="mono font-medium">{d.event}</span><span className="block truncate text-xs text-muted">{new Date(d.createdAt).toLocaleTimeString()}{d.lastError ? ` · ${d.lastError}` : ""}</span></span>
                <Pill tone={d.status === "delivered" ? "good" : d.status === "failed" ? "bad" : d.status === "skipped" ? "neutral" : "warn"}>{d.status === "skipped" ? "no URL set" : d.status}{d.attempts > 1 ? ` · ${d.attempts} tries` : ""}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
