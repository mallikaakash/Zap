"use client";

import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { copy } from "@/lib/client";

/** Zap Payments wordmark from `/brand/logo.jpg`. */
export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  if (compact) {
    return <img src="/brand/logo.jpg" alt="" aria-hidden className={`h-8 w-8 rounded-lg object-cover object-left ${className}`} />;
  }
  return <img src="/brand/logo.jpg" alt="Zap Payments" className={`h-12 w-auto max-w-[300px] object-contain ${className}`} />;
}

const TONES = {
  neutral: "bg-accent-soft text-ink",
  accent: "bg-accent-soft text-accent",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-red-50 text-red-700",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill ${TONES[tone]}`}>{children}</span>;
}

/** Always visible wherever money is not real. */
export function SimBadge({ mode }: { mode?: string }) {
  if (!mode || mode === "live") return null;
  return (
    <span className="pill bg-amber-50 text-amber-800 ring-1 ring-amber-200" title="No real money moves in this mode. Swaps are simulated; the escrow contract is real.">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Simulated · {mode === "local" ? "local sandbox" : "testnet"}
    </span>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const ring = { neutral: "border-line bg-canvas text-ink", accent: "border-line bg-accent-soft text-ink", good: "border-emerald-200 bg-emerald-50 text-emerald-900", warn: "border-amber-200 bg-amber-50 text-amber-900", bad: "border-red-200 bg-red-50 text-red-800" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : undefined} className={`rise rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${ring}`}>
      {children}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function CopyButton({ text, label = "Copy", className = "btn-ghost" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        if (await copy(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function QR({ value, size = 168 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: "svg", margin: 1, width: size, color: { dark: "#111111", light: "#ffffff" } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(""));
    return () => {
      live = false;
    };
  }, [value, size]);
  return <div aria-label="QR code" role="img" className="overflow-hidden rounded-xl border border-line bg-white p-2" style={{ width: size + 18, height: size + 18 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

/** Poll a JSON endpoint. Returns the latest data, the last error and a manual refresh. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const run = () =>
      load()
        .then((d) => {
          if (live) {
            setData(d);
            setError(null);
          }
        })
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Something went wrong"));
    void run();
    const t = setInterval(run, ms);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, tick, ...deps]);
  return { data, error, refresh: () => setTick((n) => n + 1) };
}
