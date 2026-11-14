"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chainName } from "@/lib/client";
import { Spinner } from "@/components/ui";

export interface Token {
  assetId: string;
  symbol: string;
  chain: string;
  priceUsd: string;
  decimals: number;
  contractAddress?: string;
}

/** What most buyers actually hold, in the order they are shown. */
const POPULAR: Array<[symbol: string, chain: string]> = [
  ["USDT", "pol"],
  ["USDC", "base"],
  ["USDC", "eth"],
  ["ETH", "eth"],
  ["SOL", "sol"],
  ["USDC", "sol"],
  ["BTC", "btc"],
];

const COIN_COLOURS: Record<string, string> = {
  USDT: "#26a17b",
  USDC: "#2775ca",
  ETH: "#627eea",
  WETH: "#627eea",
  SOL: "#9945ff",
  BTC: "#f7931a",
  WBTC: "#f7931a",
  NEAR: "#111111",
  WNEAR: "#111111",
  BNB: "#f0b90b",
  POL: "#8247e5",
  AVAX: "#e84142",
  TRX: "#eb0029",
  DOGE: "#c2a633",
  XRP: "#23292f",
};

function colourFor(symbol: string): string {
  const known = COIN_COLOURS[symbol.toUpperCase()];
  if (known) return known;
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 42%)`;
}

export function CoinBadge({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const text = symbol.replace(/^w(?=[A-Z])/, "").slice(0, symbol.length > 4 ? 3 : 4);
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: colourFor(symbol), fontSize: size * (text.length > 3 ? 0.27 : 0.32), letterSpacing: "-0.02em" }}
    >
      {text}
    </span>
  );
}

/** Rough amount of `t` for `amountMinor` USD (6 dp). Before swap fees, for orientation only. */
export function approx(amountMinor: string, t: Pick<Token, "priceUsd" | "symbol">): string | null {
  const price = Number(t.priceUsd);
  if (!Number.isFinite(price) || price <= 0) return null;
  const n = Number(amountMinor) / 1e6 / price;
  if (!Number.isFinite(n)) return null;
  const digits = n >= 100 ? 2 : n >= 1 ? 3 : n >= 0.01 ? 4 : 6;
  return `${n.toLocaleString("en-US", { minimumFractionDigits: n >= 1 ? 2 : 0, maximumFractionDigits: digits })} ${t.symbol}`;
}

interface Props {
  tokens: Token[] | null;
  tokensDown: boolean;
  amount: string;
  directAsset: string;
  value: string | null;
  onChange: (assetId: string) => void;
}

export function CoinPicker({ tokens, tokensDown, amount, directAsset, value, onChange }: Props) {
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (more) search.current?.focus();
  }, [more]);

  const direct: Token = { assetId: directAsset, symbol: "USDC", chain: "near", priceUsd: "1", decimals: 6 };
  const popular = useMemo(() => {
    const list = POPULAR.map(([sym, chain]) => (tokens ?? []).find((t) => t.symbol === sym && t.chain === chain)).filter((t): t is Token => !!t);
    return [...list, direct];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, directAsset]);
  const popularIds = new Set(popular.map((t) => t.assetId));

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (tokens ?? [])
      .filter((t) => !q || t.symbol.toLowerCase().includes(q) || chainName(t.chain).toLowerCase().includes(q) || t.chain.includes(q))
      .sort((a, b) => Number(popularIds.has(b.assetId)) - Number(popularIds.has(a.assetId)) || a.symbol.localeCompare(b.symbol))
      .slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, query]);

  const picked = value ? (value === directAsset ? direct : (tokens ?? []).find((t) => t.assetId === value)) : null;
  const pickedIsHidden = picked && !popularIds.has(picked.assetId);

  if (tokensDown)
    return (
      <div className="space-y-2">
        <Tile t={direct} amount={amount} selected={value === directAsset} onClick={() => onChange(directAsset)} note="No swap" />
        <p className="text-xs text-warn">Other coins are unavailable right now because prices could not be loaded. USDC on NEAR still works.</p>
      </div>
    );

  return (
    <div className="space-y-3">
      {tokens === null ? (
        <div className="grid grid-cols-2 gap-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[68px] animate-pulse rounded-2xl bg-accent-soft" />
          ))}
          <p className="col-span-2 flex items-center gap-2 text-xs text-muted"><Spinner /> Loading coins…</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Popular coins">
          {popular.map((t) => (
            <Tile key={t.assetId} t={t} amount={amount} selected={value === t.assetId} onClick={() => onChange(t.assetId)} note={t.assetId === directAsset ? "No swap" : undefined} />
          ))}
        </div>
      )}

      {pickedIsHidden ? (
        <div className="rise grid grid-cols-1">
          <Tile t={picked} amount={amount} selected onClick={() => setMore(true)} wide />
        </div>
      ) : null}

      {picked ? (
        <p className="rise flex items-center justify-between rounded-xl bg-canvas px-3.5 py-2.5 text-sm ring-1 ring-line">
          <span className="text-muted">You pay about</span>
          <span className="font-semibold tabular-nums">{picked.assetId === directAsset ? `${(Number(amount) / 1e6).toFixed(2)} USDC` : approx(amount, picked) ?? "—"}<span className="font-normal text-muted"> + network fee</span></span>
        </p>
      ) : null}

      {tokens && tokens.length > 0 ? (
        <div className={`overflow-hidden rounded-2xl border-[1.5px] transition-colors ${more ? "border-ink" : "border-dashed border-line"}`}>
          <button
            type="button"
            onClick={() => setMore(!more)}
            aria-expanded={more}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-canvas"
          >
            <span className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-muted ring-1 ring-line" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </span>
              {more ? "Hide other coins" : `Other coins and networks (${tokens.length})`}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${more ? "rotate-180" : ""}`}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {more ? (
            <div className="border-t border-line bg-canvas">
              <label className="flex items-center gap-2.5 border-b border-line bg-surface px-4">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-muted">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  ref={search}
                  className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[#8a8a8a]"
                  placeholder="Search a coin or network: USDT, Arbitrum, DOGE…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search coins"
                />
                {query ? (
                  <button type="button" className="text-xs font-semibold text-muted hover:text-ink" onClick={() => setQuery("")}>Clear</button>
                ) : null}
              </label>
              <div className="max-h-64 overflow-y-auto p-1.5" role="listbox" aria-label="All coins">
                {results.length === 0 ? (
                  <p className="p-3 text-sm text-muted">No coin matches “{query}”. Try the network name instead.</p>
                ) : (
                  results.map((t) => {
                    const on = value === t.assetId;
                    return (
                      <button
                        key={t.assetId}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => {
                          onChange(t.assetId);
                          setMore(false);
                          setQuery("");
                        }}
                        className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition ${on ? "bg-ink text-white" : "hover:bg-surface"}`}
                      >
                        <CoinBadge symbol={t.symbol} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{t.symbol}</span>
                          <span className={`block text-xs ${on ? "text-white/70" : "text-muted"}`}>on {chainName(t.chain)}</span>
                        </span>
                        <span className={`text-xs tabular-nums ${on ? "text-white/80" : "text-muted"}`}>{approx(amount, t) ? `≈ ${approx(amount, t)}` : ""}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Tile({ t, amount, selected, onClick, note, wide }: { t: Token; amount: string; selected: boolean; onClick: () => void; note?: string; wide?: boolean }) {
  const est = approx(amount, t);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`relative flex items-center gap-3 rounded-2xl border-[1.5px] px-3 py-3 text-left transition duration-150 active:scale-[0.98] ${
        selected ? "border-ink bg-surface shadow-[0_0_0_3px_rgba(255,45,135,0.18)]" : "border-line bg-surface hover:border-[#c9c9c4] hover:bg-canvas"
      }`}
    >
      <CoinBadge symbol={t.symbol} size={wide ? 32 : 30} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold">{t.symbol}</span>
          {note ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">{note}</span> : null}
        </span>
        <span className="block truncate text-xs text-muted">{chainName(t.chain)}{wide && est ? ` · ≈ ${est}` : ""}</span>
      </span>
      {selected ? (
        <span className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-pink text-white ring-2 ring-white" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
      ) : null}
    </button>
  );
}
