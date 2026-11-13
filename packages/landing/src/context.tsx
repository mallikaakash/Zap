"use client";

import { createContext, useContext, useEffect, useState, type CSSProperties } from "react";

export interface AppInfo {
  /** Origin of the checkout app ("" = this origin). pay.js, /dashboard, /verify live there. */
  appUrl: string;
  /** Absolute origin for display in snippets (filled in on the client when appUrl is ""). */
  host: string;
  /** "live" | "local" | "testnet", once known. */
  mode?: string;
  /** First registered shop, for the real "pay $1" button. */
  merchant?: string | null;
  href: (path: string) => string;
}

const Ctx = createContext<AppInfo>({ appUrl: "", host: "", href: (p) => p });
export const useApp = () => useContext(Ctx);

export function AppProvider({ appUrl, demoMerchant, children }: { appUrl: string; demoMerchant?: string; children: React.ReactNode }) {
  const base = appUrl.replace(/\/+$/, "");
  const [host, setHost] = useState(base);
  const [mode, setMode] = useState<string>();
  const [merchant, setMerchant] = useState<string | null | undefined>(demoMerchant);
  useEffect(() => {
    if (!base) setHost(window.location.origin);
    const get = <T,>(p: string) => fetch(`${base}${p}`, { headers: { accept: "application/json" } }).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)))));
    get<{ mode: string }>("/api/dev/state")
      .then((r) => setMode(r.mode))
      .catch(() => {});
    if (!demoMerchant)
      get<{ merchants: Array<{ id: string }> }>("/api/merchants")
        .then((r) => setMerchant(r.merchants[0]?.id ?? null))
        .catch(() => setMerchant(null));
  }, [base, demoMerchant]);
  return <Ctx.Provider value={{ appUrl: base, host, mode, merchant, href: (p) => `${base}${p}` }}>{children}</Ctx.Provider>;
}

/** Inline style with CSS custom properties. */
export const v = (o: Record<string, string | number>) => o as CSSProperties;
