"use client";

import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties } from "react";

export interface AppInfo {
  /** Origin of the checkout app ("" = this origin). pay.js, /dashboard, /verify live there. */
  appUrl: string;
  /** Absolute origin for display in snippets (filled in on the client when appUrl is ""). */
  host: string;
  /** "live" | "local" | "testnet", once known. */
  mode?: string;
  /** First registered shop, for the real "pay $1" button. */
  merchant?: string | null;
  /** gzip size of the pay.js this host serves, measured in the browser. */
  payJsGzip?: number;
  href: (path: string) => string;
}

/** Fetch pay.js and gzip it with the browser's CompressionStream: the size of the file actually served. */
async function measureGzip(url: string): Promise<number | undefined> {
  if (typeof CompressionStream === "undefined") return undefined;
  const res = await fetch(url);
  if (!res.ok || !res.body) return undefined;
  const reader = res.body.pipeThrough(new CompressionStream("gzip")).getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return bytes;
    bytes += value.byteLength;
  }
}

const Ctx = createContext<AppInfo>({ appUrl: "", host: "", href: (p) => p });
export const useApp = () => useContext(Ctx);

export function AppProvider({ appUrl, demoMerchant, children }: { appUrl: string; demoMerchant?: string; children: React.ReactNode }) {
  const base = appUrl.replace(/\/+$/, "");
  const [host, setHost] = useState(base);
  /** Default not-live until /api/dev/state proves otherwise (chip visible on first paint). */
  const [mode, setMode] = useState<string>("local");
  const [merchant, setMerchant] = useState<string | null | undefined>(demoMerchant);
  const href = useCallback((p: string) => `${base}${p}`, [base]);
  const [payJsGzip, setPayJsGzip] = useState<number>();
  useEffect(() => {
    if (!base) setHost(window.location.origin);
    const get = <T,>(p: string) => fetch(`${base}${p}`, { headers: { accept: "application/json" } }).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)))));
    const setModeFrom = (r: { mode?: string }) => {
      if (r.mode) setMode(r.mode);
    };
    get<{ mode: string }>("/api/dev/state")
      .then(setModeFrom)
      .catch(() =>
        get<{ mode: string }>("/api/health")
          .then(setModeFrom)
          .catch(() => setMode("local")),
      );
    measureGzip(`${base}/pay.js`)
      .then(setPayJsGzip)
      .catch(() => {});
    if (!demoMerchant)
      get<{ merchants: Array<{ id: string }> }>("/api/merchants")
        .then((r) => setMerchant(r.merchants[0]?.id ?? null))
        .catch(() => setMerchant(null));
  }, [base, demoMerchant]);
  return <Ctx.Provider value={{ appUrl: base, host, mode, merchant, payJsGzip, href }}>{children}</Ctx.Provider>;
}

/** Inline style with CSS custom properties. */
export const v = (o: Record<string, string | number>) => o as CSSProperties;
