"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { newReceiptKey, receiptPublicKey } from "@uc/chain/receipt-key";
import { api, chainName, short, usd } from "@/lib/client";
import { EVM_CHAINS, hasWallet, isEvmChain, payWithWallet, txUrl } from "@/lib/evm";
import { CopyButton, Field, Logo, Notice, QR, SimBadge, Spinner, usePoll } from "@/components/ui";

interface Session {
  id: string;
  merchantName: string;
  product: string | null;
  amount: string;
  kind: "OneTime" | "Subscription" | "Schedule";
  schedule: Array<{ afterSecs: number; amount: string }>;
  status: string;
  originSymbol: string | null;
  originChain: string | null;
  refundAddress: string | null;
  direct: boolean;
  payTo: { contract: string; token: string } | null;
  depositAddress: string | null;
  depositMemo: string | null;
  amountIn: string | null;
  amountInFormatted: string | null;
  originAsset: string | null;
  depositTx: string | null;
  quoteDeadline: string | null;
  receiptId: string | null;
  error: string | null;
  mode: string;
  canSimulate: boolean;
  directAsset: string;
}

interface Token {
  assetId: string;
  symbol: string;
  chain: string;
  priceUsd: string;
  decimals: number;
  contractAddress?: string;
}

const KEY = (id: string) => `uc:receipt-key:${id}`;
const PLACEHOLDER: Record<string, string> = { sol: "Your Solana address", tron: "T…", btc: "bc1…", near: "you.near" };

function Steps({ status }: { status: string }) {
  const at = status === "paid" ? 3 : status === "deposit_detected" ? 1 : 0;
  const steps = ["Waiting for payment", "Payment detected", "Converting to USDC", "Paid"];
  return (
    <ol className="space-y-2.5" aria-label="Payment progress">
      {steps.map((label, i) => {
        const done = at > i || status === "paid";
        const active = !done && (i === at || (at === 1 && i === 2));
        return (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition-colors ${done ? "bg-good text-white" : active ? "bg-accent-soft text-accent" : "bg-accent-soft text-[#8a8a8a]"}`}>
              {done ? "✓" : active ? <Spinner /> : i + 1}
            </span>
            <span className={done || active ? "font-medium text-ink" : "text-muted"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function Checkout({ sessionId }: { sessionId: string }) {
  // Read on the client only, so the server and first client render match.
  const [embed, setEmbed] = useState(false);
  useEffect(() => setEmbed(new URLSearchParams(window.location.search).get("embed") === "1"), []);
  const { data: s, error: loadError, refresh } = usePoll(() => api<Session>(`/api/sessions/${sessionId}`), 1500, [sessionId]);
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [tokensDown, setTokensDown] = useState(false);
  const [query, setQuery] = useState("");
  const [asset, setAsset] = useState<string | null>(null);
  const [refund, setRefund] = useState("");
  const [email, setEmail] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletOk, setWalletOk] = useState(false);
  useEffect(() => setWalletOk(hasWallet()), []);
  const [busy, setBusy] = useState<"quote" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const announced = useRef(false);

  useEffect(() => {
    api<{ tokens: Token[] }>("/api/tokens")
      .then((r) => setTokens(r.tokens))
      .catch(() => {
        setTokens([]);
        setTokensDown(true);
      });
    setPrivateKey(localStorage.getItem(KEY(sessionId)));
  }, [sessionId]);

  // Talk to the merchant page when shown inside the pay button's modal.
  const post = (type: string, extra: Record<string, unknown> = {}) => {
    if (embed && window.parent !== window) window.parent.postMessage({ source: "zap", type, sessionId, ...extra }, "*");
  };
  useEffect(() => {
    if (!embed || !root.current) return;
    const ro = new ResizeObserver(() => post("uc:resize", { height: Math.ceil(root.current!.getBoundingClientRect().height) }));
    ro.observe(root.current);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && post("uc:close");
    window.addEventListener("keydown", onKey);
    return () => {
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed]);
  useEffect(() => {
    if (s?.status === "paid" && s.receiptId && !announced.current) {
      announced.current = true;
      // The parent page gets the receipt URL WITHOUT the key fragment: the key stays with the customer.
      post("uc:paid", { receiptId: s.receiptId, receiptUrl: `${window.location.origin}/r/${s.receiptId}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.status, s?.receiptId]);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tokens ?? []).filter((t) => !q || t.symbol.toLowerCase().includes(q) || chainName(t.chain).toLowerCase().includes(q) || t.chain.includes(q)).slice(0, 60);
  }, [tokens, query]);
  const picked = asset && s ? (asset === s.directAsset ? { symbol: "USDC", chain: "near" } : (tokens ?? []).find((t) => t.assetId === asset)) : null;

  if (loadError && !s) return <Shell embed={embed}>{<Notice tone="bad">{loadError}</Notice>}</Shell>;
  if (!s) return <Shell embed={embed}>{<p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading your order…</p>}</Shell>;

  const choosing = editing || ["created", "expired"].includes(s.status);

  async function getQuote() {
    if (!asset) return setError("Pick the coin you want to pay with.");
    if (!refund.trim()) return setError("Enter the address refunds should go back to.");
    setBusy("quote");
    setError(null);
    try {
      // The receipt key is made here, in the browser. Only its public half is sent.
      let key = localStorage.getItem(KEY(sessionId));
      if (!key) {
        key = (await newReceiptKey()).privateKey;
        localStorage.setItem(KEY(sessionId), key);
      }
      setPrivateKey(key);
      await api(`/api/sessions/${sessionId}/quote`, { body: { originAsset: asset, refundAddress: refund.trim(), receiptKey: await receiptPublicKey(key), email: email.trim() || undefined } });
      setEditing(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get a quote.");
    } finally {
      setBusy(null);
    }
  }

  /** Fill the refund address from the connected wallet (it is the address the coins come from). */
  async function useWalletAddress() {
    try {
      const accounts = (await window.ethereum!.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts[0]) setRefund(accounts[0]);
    } catch {
      setError("Could not read an address from your wallet.");
    }
  }

  async function payFromWallet() {
    if (!s?.depositAddress || !s.amountIn || !s.originChain) return;
    const token = (tokens ?? []).find((t) => t.assetId === s.originAsset);
    setWalletBusy(true);
    setError(null);
    try {
      const txHash = await payWithWallet({ chain: s.originChain, tokenContract: token?.contractAddress, to: s.depositAddress, amount: s.amountIn });
      await api(`/api/sessions/${sessionId}/deposit`, { body: { txHash } }).catch(() => undefined);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet payment did not go through.");
    } finally {
      setWalletBusy(false);
    }
  }

  async function simulate() {
    setBusy("pay");
    setError(null);
    try {
      await api(`/api/sessions/${sessionId}/simulate`, { method: "POST" });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The simulated payment failed.");
    } finally {
      setBusy(null);
    }
  }

  const receiptHref = s.receiptId ? `/r/${s.receiptId}${privateKey ? `#k=${privateKey}` : ""}` : "#";

  return (
    <Shell embed={embed} innerRef={root}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{s.merchantName}</p>
          <h1 className="mt-1 text-lg font-semibold">{s.product ?? "Your order"}</h1>
          <p className="mt-0.5 text-xs text-muted">
            {s.kind === "OneTime" ? "One-time payment" : s.kind === "Subscription" ? `Prepaid plan · ${s.schedule.length} periods, released to the business over time` : `Paid in ${s.schedule.length} milestones, released to the business over time`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">{usd(s.amount)}</p>
          <p className="text-xs text-muted">USD</p>
        </div>
      </header>
      <div className="mt-3">
        <SimBadge mode={s.mode} />
      </div>

      <div className="mt-5 space-y-4">
        {error ? <Notice tone="bad">{error}</Notice> : null}

        {s.status === "paid" ? (
          <div className="rise space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-2xl text-good">✓</div>
            <div>
              <h2 className="text-lg font-semibold">Payment complete</h2>
              <p className="mt-1 text-sm text-muted">
                Your money is held by receipt #{s.receiptId}, not by the business, until the refund period ends.
              </p>
            </div>
            <a className="btn-primary w-full" href={receiptHref} target={embed ? "_blank" : undefined} rel="noreferrer">
              Open your receipt
            </a>
            <Notice tone="warn">
              <strong>Keep the receipt link.</strong> It contains the key to this receipt: anyone with the link can request a refund to your original address or claim the receipt. It is not stored on our servers.
              {privateKey ? (
                <span className="mt-2 block space-y-2">
                  <CopyButton text={`${window.location.origin}${receiptHref}`} label="Copy receipt link" />
                  <EmailLink receiptId={s.receiptId!} link={`${window.location.origin}${receiptHref}`} />
                </span>
              ) : (
                <span className="mt-2 block">This browser does not have the key for this receipt. Open the link on the device you paid from.</span>
              )}
            </Notice>
          </div>
        ) : ["failed", "underpaid"].includes(s.status) ? (
          <div className="space-y-3">
            <Notice tone="bad">{s.error ?? "This payment did not complete."}</Notice>
            <p className="text-sm text-muted">Nothing was charged. Go back to the business's site to start a new payment.</p>
          </div>
        ) : choosing ? (
          <div className="space-y-4">
            {s.status === "expired" ? <Notice tone="warn">The previous quote expired before a payment arrived. Pick a coin to get a fresh one.</Notice> : null}
            <div>
              <span className="label">Pay with</span>
              <button
                type="button"
                onClick={() => setAsset(s.directAsset)}
                aria-pressed={asset === s.directAsset}
                className={`mb-2 flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-left text-sm transition ${asset === s.directAsset ? "border-accent bg-accent-soft" : "border-line hover:bg-canvas"}`}
              >
                <span>
                  <span className="font-semibold">USDC on NEAR</span>
                  <span className="block text-xs text-muted">No swap. Goes straight into the receipt contract.</span>
                </span>
                <span className="tabular-nums text-muted">{usd(s.amount).slice(1)} USDC</span>
              </button>
              {tokensDown ? (
                <Notice tone="warn">Other coins are unavailable right now because prices could not be loaded. USDC on NEAR still works.</Notice>
              ) : (
                <>
                  <input className="input" placeholder="Search coin or network (USDT, Polygon, SOL…)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search coins" />
                  <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-line" role="listbox" aria-label="Coins">
                    {tokens === null ? (
                      <p className="flex items-center gap-2 p-3 text-sm text-muted"><Spinner /> Loading coins…</p>
                    ) : options.length === 0 ? (
                      <p className="p-3 text-sm text-muted">No coin matches “{query}”. Try the network name, or pay with USDC on NEAR.</p>
                    ) : (
                      options.map((t) => (
                        <button
                          key={t.assetId}
                          type="button"
                          role="option"
                          aria-selected={asset === t.assetId}
                          onClick={() => setAsset(t.assetId)}
                          className={`flex w-full items-center justify-between border-b border-line px-3.5 py-2.5 text-left text-sm last:border-b-0 ${asset === t.assetId ? "bg-accent-soft" : "hover:bg-canvas"}`}
                        >
                          <span className="font-semibold">{t.symbol}</span>
                          <span className="text-xs text-muted">{chainName(t.chain)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            <Field
              label={picked ? `Your ${chainName(picked.chain)} address for refunds` : "Refund address"}
              hint="If you ask for a refund, it is sent here in the same coin. Use your own wallet, not an exchange deposit address: exchanges may not credit it."
            >
              <span className="flex gap-2">
                <input className="input mono" value={refund} onChange={(e) => setRefund(e.target.value)} placeholder={picked ? (PLACEHOLDER[picked.chain] ?? "0x…") : "Pick a coin first"} autoComplete="off" spellCheck={false} />
                {walletOk && picked && isEvmChain(picked.chain) ? (
                  <button type="button" className="btn-ghost shrink-0" onClick={useWalletAddress}>Use MetaMask</button>
                ) : null}
              </span>
            </Field>
            <Field label="Email (optional)" hint="For payment and refund updates.">
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
            </Field>
            <button className="btn-primary w-full" onClick={getQuote} disabled={busy !== null}>
              {busy === "quote" ? <><Spinner /> Getting quote…</> : "Continue"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-canvas p-4">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">Send exactly</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {s.amountInFormatted} <span className="text-base text-muted">{s.originSymbol}</span>
              </p>
              <p className="text-xs text-muted">
                on {chainName(s.originChain)} · the business receives {usd(s.amount)} in USDC
              </p>
            </div>
            {s.status === "quoted" ? (
              s.direct && s.payTo ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted">
                    From your NEAR wallet, send the USDC to the receipt contract with <span className="mono">ft_transfer_call</span>. The contract mints your receipt in the same transaction.
                  </p>
                  <div className="mono rounded-xl border border-line p-3 text-xs break-all">{s.payTo.contract}</div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                  <QR value={s.depositAddress ?? ""} size={132} />
                  <div className="min-w-0 flex-1 space-y-2">
                    {isEvmChain(s.originChain) && !s.canSimulate ? (
                      <button className="btn-primary w-full" onClick={payFromWallet} disabled={walletBusy || !walletOk}>
                        {walletBusy ? <><Spinner /> Confirm in MetaMask…</> : walletOk ? `Pay ${s.amountInFormatted} ${s.originSymbol} with MetaMask` : "MetaMask not found — send manually below"}
                      </button>
                    ) : null}
                    <p className="label">Deposit address</p>
                    <p className="mono rounded-xl border border-line p-3 text-xs break-all">{s.depositAddress}</p>
                    {s.depositMemo ? <p className="text-xs text-warn">Memo required: <span className="mono">{s.depositMemo}</span></p> : null}
                    <div className="flex flex-wrap gap-2">
                      <CopyButton text={s.depositAddress ?? ""} label="Copy address" />
                      <CopyButton text={s.amountInFormatted ?? ""} label="Copy amount" />
                    </div>
                    {s.canSimulate ? <p className="text-xs text-warn">This address is a placeholder for the simulation. Do not send real coins to it.</p> : null}
                  </div>
                </div>
              )
            ) : null}
            {s.depositTx && s.originChain && EVM_CHAINS[s.originChain] ? (
              <p className="text-xs text-muted">
                Your transaction:{" "}
                <a className="mono link" href={txUrl(s.originChain, s.depositTx)} target="_blank" rel="noreferrer">
                  {short(s.depositTx, 10, 8)}
                </a>
              </p>
            ) : null}
            <Steps status={s.status} />
            {s.status === "quoted" && s.canSimulate ? (
              <button className="btn-primary w-full" onClick={simulate} disabled={busy !== null}>
                {busy === "pay" ? <><Spinner /> Sending…</> : "Simulate payment"}
              </button>
            ) : null}
            {s.status === "quoted" ? (
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Refunds go to {short(s.refundAddress)}</span>
                <button type="button" className="link" onClick={() => { setEditing(true); setAsset(null); }}>
                  Change coin
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted">This usually takes a few seconds here; real cross-chain swaps take about a minute.</p>
            )}
            {s.error && s.status !== "quoted" ? <p className="text-xs text-muted">{s.error}</p> : null}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ embed, children, innerRef }: { embed: boolean; children: React.ReactNode; innerRef?: React.RefObject<HTMLDivElement | null> }) {
  if (embed)
    return (
      <div ref={innerRef} className="bg-surface p-5">
        {children}
        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted">
          <Logo className="text-[11px]" />
        </p>
      </div>
    );
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-5 flex justify-center">
        <Logo />
      </div>
      <div ref={innerRef} className="card p-6">
        {children}
      </div>
      <p className="mt-4 text-center text-xs text-muted">Funds are held by a public NEAR contract, not by a company. Hackathon prototype, unaudited.</p>
    </main>
  );
}

/** Email the receipt link (it contains the key, so only on the customer's request). */
function EmailLink({ receiptId, link }: { receiptId: string; link: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | string>("idle");
  if (state === "sent") return <span className="block text-sm font-medium text-good">Sent. Check your inbox.</span>;
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        try {
          await api(`/api/receipts/${receiptId}/email`, { body: { email, link } });
          setState("sent");
        } catch (err) {
          setState(err instanceof Error ? err.message : "Could not send");
        }
      }}
    >
      <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email me this link" aria-label="Your email" />
      <button className="btn-ghost shrink-0" disabled={state === "busy"}>{state === "busy" ? <Spinner /> : "Send"}</button>
      {state !== "idle" && state !== "busy" ? <span className="text-xs text-bad">{state}</span> : null}
    </form>
  );
}
