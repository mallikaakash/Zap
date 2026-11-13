"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { receiptPublicKey, signReceiptAction, type ReceiptAction } from "@uc/chain/receipt-key";
import { api, chainName, fromMinor, keyFromFragment, sha256Hex, short, toMinor, until, usd } from "@/lib/client";
import { EVENT_LABELS, receiptStatus } from "@/lib/labels";
import type { CaseView, ReceiptView } from "@/lib/types";
import { Field, Logo, Notice, Pill, SimBadge, Spinner, usePoll } from "@/components/ui";

type Panel = null | "refund" | "cancel" | "claim" | "transfer" | "address";

export default function ReceiptPage({ id }: { id: string }) {
  const { data: v, error: loadError, refresh } = usePoll(() => api<ReceiptView>(`/api/receipts/${id}`), 2000, [id]);
  const [key, setKey] = useState<string | null>(null);
  const [keyOk, setKeyOk] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => setKey(keyFromFragment()), []);
  const receiptKey = v?.receipt.receiptKey;
  useEffect(() => {
    if (!key || receiptKey === undefined) return;
    if (receiptKey === null) return setKeyOk(false);
    receiptPublicKey(key).then((pub) => setKeyOk(pub === receiptKey)).catch(() => setKeyOk(false));
  }, [key, receiptKey]);

  if (loadError && !v) return <Frame><Notice tone="bad">{loadError}</Notice></Frame>;
  if (!v) return <Frame><p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading receipt…</p></Frame>;

  const r = v.receipt;
  const q = r.request;
  const status = receiptStatus(r);
  const held = BigInt(r.amount) - BigInt(r.released) - BigInt(r.refunded);
  const canSign = !r.claimed && keyOk === true;
  const canAct = canSign || (r.claimed && v.ownerIsDemoAccount);
  const openCase = v.cases.find((c) => !c.closed) ?? v.cases[0] ?? null;
  const windowOpen = r.kind === "OneTime" && !r.confirmed && new Date(r.windowEnd) > new Date(v.chainNow);

  /** Sign an action in the browser (unclaimed) or name the demo owner (claimed). The server only relays. */
  async function auth(action: ReceiptAction): Promise<Record<string, string>> {
    if (r.claimed) return { owner: r.owner };
    const fresh = await api<ReceiptView>(`/api/receipts/${id}`);
    return { sig: await signReceiptAction(key!, v!.contract, id, fresh.receipt.nonce, action) };
  }

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(label);
      setPanel(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame>
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">{v.merchant.name} · Receipt #{r.id}</p>
            <h1 className="mt-1 text-xl font-semibold">{v.product ?? "Your order"}</h1>
          </div>
          <p className="text-2xl font-semibold tabular-nums">{usd(r.amount)}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Pill tone={status.tone}>{status.label}</Pill>
          <SimBadge mode={v.mode} />
          {r.claimed ? <Pill>Owned by {short(r.owner, 14, 8)}</Pill> : null}
          {r.transferable ? <Pill>Transferable</Pill> : null}
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
          {[
            ["Held", usd(held)],
            ["Paid to shop", usd(r.released)],
            ["Refunded", usd(r.refunded)],
          ].map(([k, val]) => (
            <div key={k} className="rounded-xl bg-canvas px-3 py-2.5">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{val}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 text-sm leading-relaxed text-ink">
          {r.kind === "OneTime" ? (
            held === 0n ? null : r.confirmed ? (
              <p>You confirmed the order arrived, so the shop can be paid now.</p>
            ) : windowOpen ? (
              <p>
                The money stays in the receipt contract for another <strong>{until(r.windowEnd, v.chainNow)}</strong>. Until then you can ask for a refund; after that it is paid to the shop.
              </p>
            ) : (
              <p>The refund period has ended. The money is being paid to the shop.</p>
            )
          ) : (
            <ol className="mt-1 space-y-1.5">
              {r.schedule.map((t, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                  <span className="text-muted">
                    {r.kind === "Subscription" ? "Period" : "Milestone"} {i + 1}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{usd(t.amount)}</span>
                    {t.state === "Released" ? <Pill tone="good">Paid to shop</Pill> : t.state === "Refunded" ? <Pill>Refunded</Pill> : t.state === "RefundPending" ? <Pill tone="warn">Refund pending</Pill> : <Pill tone="accent">{new Date(t.at) <= new Date(v.chainNow) ? "Due now" : `in ${until(t.at, v.chainNow)}`}</Pill>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {v.paidWith?.symbol ? (
          <p className="mt-4 text-xs text-muted">
            Paid with {v.paidWith.amountFormatted} {v.paidWith.symbol} on {chainName(v.paidWith.chain)}. Refunds go to <span className="mono">{short(r.refundTarget.address, 10, 8)}</span> in the same coin, converted at the rate on the day of the refund, minus the swap fee.
          </p>
        ) : null}
      </div>

      {error ? <Notice tone="bad">{error}</Notice> : null}
      {done ? <Notice tone="good">{done}</Notice> : null}

      {!r.claimed && key === null ? (
        <Notice tone="warn">You are viewing this receipt without its key, so you can read it but not act on it. Open the full receipt link you saved after paying (it ends in <span className="mono">#k=…</span>). Lost it? Ask the shop: they can refund you without it.</Notice>
      ) : !r.claimed && keyOk === false ? (
        <Notice tone="bad">The key in this link does not match this receipt. Check that you copied the whole link.</Notice>
      ) : r.claimed && !v.ownerIsDemoAccount ? (
        <Notice>This receipt belongs to {r.owner}. Its owner acts on it from their NEAR wallet.</Notice>
      ) : null}

      {openCase ? <Chat c={openCase} v={v} canAct={canAct} busy={busy} onSend={(text, imageName) => act("Message sent.", async () => api(`/api/receipts/${id}/messages`, { body: { text, imageName, ...(r.claimed ? { owner: r.owner } : { sig: await signReceiptAction(key!, v.contract, id, (await api<ReceiptView>(`/api/receipts/${id}`)).receipt.nonce, { action: "message", bodyHash: await sha256Hex(text.trim().slice(0, 2000)) }) }) } }))} onAppeal={() => act("Appeal sent to the shop.", async () => api(`/api/receipts/${id}/appeal`, { body: await auth({ action: "appeal" }) }))} /> : null}

      {canAct ? (
        <div className="card p-5">
          <h2 className="text-sm font-semibold">What you can do</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {r.kind === "OneTime" && BigInt(v.refundable) > 0n ? <button className="btn-ghost" onClick={() => setPanel(panel === "refund" ? null : "refund")}>Request refund</button> : null}
            {r.kind !== "OneTime" && BigInt(v.refundable) > 0n ? <button className="btn-ghost" onClick={() => setPanel(panel === "cancel" ? null : "cancel")}>Cancel and refund the rest</button> : null}
            {r.kind === "OneTime" && windowOpen && held > 0n && !(q && ["Open", "AiApproved", "Escalated", "Approved"].includes(q.state)) ? (
              <button className="btn-ghost" disabled={busy} onClick={() => act("Thanks. The shop can now be paid.", async () => api(`/api/receipts/${id}/confirm`, { body: await auth({ action: "confirm_received" }) }))}>
                It arrived, pay the shop
              </button>
            ) : null}
            {!r.claimed ? <button className="btn-ghost" onClick={() => setPanel(panel === "claim" ? null : "claim")}>Claim to a NEAR account</button> : null}
            {r.claimed && r.transferable ? <button className="btn-ghost" onClick={() => setPanel(panel === "transfer" ? null : "transfer")}>Transfer to someone</button> : null}
            {held > 0n ? <button className="btn-ghost" onClick={() => setPanel(panel === "address" ? null : "address")}>Change refund address</button> : null}
          </div>

          {panel === "refund" || panel === "cancel" ? (
            <RequestForm
              kind={panel}
              max={v.refundable}
              busy={busy}
              ai={v.merchant.aiTriage}
              onSubmit={(reason, amount, imageName) =>
                act(panel === "refund" ? "Refund requested. The money stays in escrow while it is reviewed." : "Cancellation requested. Periods not yet due stay in escrow while it is reviewed.", async () => {
                  const reasonHash = await sha256Hex(reason);
                  const a = await auth(panel === "refund" ? { action: "request_refund", amount, reasonHash } : { action: "cancel", reasonHash });
                  await api(`/api/receipts/${id}/${panel}`, { body: { reason, amount, imageName, ...a } });
                })
              }
            />
          ) : null}

          {panel === "claim" || panel === "transfer" ? (
            <NameForm
              busy={busy}
              label={panel === "claim" ? "NEAR account" : "Send to NEAR account"}
              hint={panel === "claim" ? `Moves this receipt into an account as an NFT. From then on that account controls it${r.transferable ? " and can transfer it" : ""}, and this link stops working.${v.mode !== "live" ? " In this demo, a plain name creates a throwaway account for you." : " Use an account you already have, like alice.near. After claiming, refunds and transfers need that account's own wallet; this page can't act for it any more."}` : "The new owner gets every right this receipt carries, including refunds of what has not been paid out."}
              cta={panel === "claim" ? "Claim receipt" : "Transfer"}
              onSubmit={(name) =>
                act(panel === "claim" ? "Receipt claimed." : "Receipt transferred.", async () => {
                  if (panel === "transfer") return api(`/api/receipts/${id}/transfer`, { body: { owner: r.owner, to: name } });
                  const { account } = await api<{ account: string }>("/api/dev/account", { body: { name } });
                  const sig = await signReceiptAction(key!, v.contract, id, (await api<ReceiptView>(`/api/receipts/${id}`)).receipt.nonce, { action: "claim", account });
                  await api(`/api/receipts/${id}/claim`, { body: { account, sig } });
                })
              }
            />
          ) : null}

          {panel === "address" ? (
            <NameForm
              busy={busy}
              mono
              label={`New ${chainName(r.refundTarget.chain)} address for refunds`}
              hint="Use your own wallet on the same network, not an exchange deposit address."
              cta="Save address"
              onSubmit={(address) =>
                act("Refund address updated.", async () => {
                  const target = { ...r.refundTarget, address };
                  await api(`/api/receipts/${id}/target`, { body: { target, ...(await auth({ action: "set_refund_target", ...target })) } });
                })
              }
            />
          ) : null}
        </div>
      ) : null}

      <div className="card p-5">
        <h2 className="text-sm font-semibold">History</h2>
        <ol className="mt-3 space-y-2.5">
          {v.events.map((e, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <span>
                <span className="font-medium">{EVENT_LABELS[e.event] ?? e.event.replace(/_/g, " ")}</span>
                {typeof e.data.amount === "string" && /^\d+$/.test(e.data.amount) ? <span className="text-muted"> · {usd(e.data.amount)}</span> : null}
                <span className="block text-xs text-muted">
                  {new Date(e.at).toLocaleString()}
                  {e.txHash ? <> · tx <span className="mono">{short(e.txHash, 6, 6)}</span></> : null}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          Contract <span className="mono">{v.contract}</span> on {v.networkId} · order reference is stored on chain only as a hash ·{" "}
          <a className="link" href={`/verify/${r.id}`}>
            Verify this receipt
          </a>
        </p>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
      <div className="flex justify-center pb-1">
        <a href="/"><Logo /></a>
      </div>
      {children}
    </main>
  );
}

function Photo({ name, onPick }: { name: string; onPick: (n: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0]?.name ?? "")} />
      <button type="button" className="btn-ghost" onClick={() => ref.current?.click()}>
        {name ? `📎 ${short(name, 12, 6)}` : "Add photo"}
      </button>
    </>
  );
}

function RequestForm({ kind, max, busy, ai, onSubmit }: { kind: "refund" | "cancel"; max: string; busy: boolean; ai: boolean; onSubmit: (reason: string, amount: string, imageName?: string) => void }) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(fromMinor(max).replace(/,/g, ""));
  const [photo, setPhoto] = useState("");
  const minor = kind === "cancel" ? max : toMinor(amount);
  const bad = !minor || BigInt(minor) <= 0n || BigInt(minor) > BigInt(max);
  return (
    <form
      className="rise mt-4 space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!bad && reason.trim().length >= 3) onSubmit(reason.trim(), minor!, photo || undefined);
      }}
    >
      <Field label="What went wrong?" hint={ai ? "The shop's refund assistant reads this first and may ask a follow-up question." : "This goes to the shop. If they do not answer in time, the refund is approved automatically."}>
        <textarea className="input min-h-24" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "refund" ? "For example: it arrived damaged, or it never arrived" : "For example: I no longer need the remaining months"} maxLength={2000} required />
      </Field>
      {kind === "refund" ? (
        <Field label="Amount (USD)" hint={`Up to $${fromMinor(max)}. A cross-chain refund pays a swap fee out of this amount.`}>
          <input className="input tabular-nums" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={bad} />
        </Field>
      ) : (
        <p className="text-sm text-muted">${fromMinor(max)} for periods that have not started will be refunded. Periods already due stay with the shop.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Photo name={photo} onPick={setPhoto} />
        <button className="btn-primary" disabled={busy || bad || reason.trim().length < 3}>
          {busy ? <><Spinner /> Sending…</> : kind === "refund" ? "Request refund" : "Cancel and refund"}
        </button>
      </div>
      {photo ? <p className="text-xs text-muted">Only the photo's file name is recorded in this prototype; the image itself is not uploaded.</p> : null}
    </form>
  );
}

function NameForm({ label, hint, cta, busy, mono, onSubmit }: { label: string; hint: string; cta: string; busy: boolean; mono?: boolean; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="rise mt-4 space-y-3 border-t border-line pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <Field label={label} hint={hint}>
        <input className={`input ${mono ? "mono" : ""}`} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} required />
      </Field>
      <button className="btn-primary" disabled={busy || !value.trim()}>
        {busy ? <><Spinner /> Working…</> : cta}
      </button>
    </form>
  );
}

function Chat({ c, v, canAct, busy, onSend, onAppeal }: { c: CaseView; v: ReceiptView; canAct: boolean; busy: boolean; onSend: (text: string, imageName?: string) => void; onAppeal: () => void }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState("");
  const q = v.receipt.request;
  const asking = !c.closed && c.aiState === "asking" && q?.state === "Open";
  const state: ReactNode =
    c.payoutState === "delivered" ? (
      <>Refund delivered{c.amountOutFormatted ? `: ${c.amountOutFormatted}` : ""}.</>
    ) : c.payoutState === "sent" ? (
      <>Your refund left escrow and is being converted back to your coin.</>
    ) : c.payoutState === "failed" ? (
      <>The refund swap failed. The shop has been told.</>
    ) : q?.state === "AiApproved" && q.vetoUntil ? (
      <>Approved for {usd(q.amount)}. It is sent in {until(q.vetoUntil, v.chainNow)} unless the shop objects.</>
    ) : q?.state === "Escalated" || (q?.state === "Open" && !asking) ? (
      <>With the shop. If they do not answer within {until(q.decisionDeadline, v.chainNow)}, it is approved automatically.</>
    ) : q?.state === "Approved" ? (
      <>Approved. Your refund is being sent.</>
    ) : q?.state === "Rejected" ? (
      <>The shop declined this request.</>
    ) : q?.state === "AiDenied" ? (
      <>Declined under the shop's policy.{q.appealed ? "" : " You can appeal once."}</>
    ) : asking ? (
      <>Waiting for your reply.</>
    ) : null;
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{c.kind === "cancel" ? "Cancellation" : c.kind === "merchant" ? "Refund from the shop" : "Refund request"} · {usd(q?.amount ?? c.amount)}</h2>
        {c.decision ? <Pill tone="neutral">{c.decision.engine === "near-ai" ? "NEAR AI · private inference" : "Rule-based assistant"}</Pill> : null}
      </div>
      <ol className="mt-3 space-y-2.5" aria-live="polite">
        {c.messages.map((m, i) => (
          <li key={i} className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === "customer" ? "bg-accent text-white" : m.role === "system" ? "bg-canvas text-muted" : "border border-line bg-surface"}`}>
              {m.role !== "customer" && m.role !== "system" ? <span className="mb-0.5 block text-[11px] font-semibold tracking-wide text-muted uppercase">{m.role === "agent" ? "Refund assistant" : v.merchant.name}</span> : null}
              {m.text}
              {m.imageName ? <span className="mt-1 block text-xs opacity-80">📎 {m.imageName}</span> : null}
            </div>
          </li>
        ))}
      </ol>
      {state ? <p className="mt-3 text-sm font-medium text-ink">{state}</p> : null}
      {c.error && c.payoutState === "none" && q?.state === "Approved" ? <p className="mt-1 text-xs text-muted">Still trying to send it: {c.error}</p> : null}
      {canAct && asking ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim() || photo) {
              onSend(text.trim() || "(photo attached)", photo || undefined);
              setText("");
              setPhoto("");
            }
          }}
        >
          <input className="input min-w-0 flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" aria-label="Reply" maxLength={2000} />
          <Photo name={photo} onPick={setPhoto} />
          <button className="btn-primary" disabled={busy || (!text.trim() && !photo)}>{busy ? <Spinner /> : "Send"}</button>
        </form>
      ) : null}
      {canAct && q?.state === "AiDenied" && !q.appealed ? (
        <button className="btn-ghost mt-3" disabled={busy} onClick={onAppeal}>
          Appeal to the shop
        </button>
      ) : null}
    </div>
  );
}
