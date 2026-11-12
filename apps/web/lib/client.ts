"use client";

/** Browser-side helpers shared by the hosted pages. */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** "49990000" → "49.99" */
export function fromMinor(minor: string | bigint | null | undefined, decimals = 6, minFrac = 2): string {
  const n = BigInt(minor ?? 0);
  const base = 10n ** BigInt(decimals);
  let frac = (n % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (frac.length < minFrac) frac = frac.padEnd(minFrac, "0");
  return `${(n / base).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

export const usd = (minor: string | bigint | null | undefined): string => `$${fromMinor(minor)}`;

/** "49.99" → "49990000"; returns null when it is not a valid amount. */
export function toMinor(value: string, decimals = 6): string | null {
  const v = value.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const [whole = "0", frac = ""] = v.split(".");
  if (frac.length > decimals) return null;
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0")).toString();
}

export const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum",
  pol: "Polygon",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  bsc: "BNB Chain",
  avax: "Avalanche",
  sol: "Solana",
  tron: "Tron",
  btc: "Bitcoin",
  near: "NEAR",
  ton: "TON",
  stellar: "Stellar",
  xrp: "XRP Ledger",
  doge: "Dogecoin",
  ltc: "Litecoin",
};
export const chainName = (c: string | null | undefined): string => (c ? (CHAIN_NAMES[c] ?? c.toUpperCase()) : "");

export function short(s: string | null | undefined, head = 8, tail = 6): string {
  if (!s) return "";
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** "in 2 d 3 h", "in 4 min", "now" — relative to the chain clock, not the device clock. */
export function until(target: string, now: string): string {
  let s = Math.floor((new Date(target).getTime() - new Date(now).getTime()) / 1000);
  if (s <= 0) return "now";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

export function duration(secs: number): string {
  if (secs % 86400 === 0 && secs >= 86400) return `${secs / 86400} day${secs === 86400 ? "" : "s"}`;
  if (secs % 3600 === 0 && secs >= 3600) return `${secs / 3600} hour${secs === 3600 ? "" : "s"}`;
  if (secs >= 60) return `${Math.round(secs / 60)} min`;
  return `${secs} s`;
}

/** The receipt's private key lives in the URL fragment (`#k=…`), which browsers never send to a server. */
export function keyFromFragment(): string | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/(?:^#|&)k=([0-9a-f]{64})(?:&|$)/);
  return m ? m[1]! : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
