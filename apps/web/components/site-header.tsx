"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui";

const SAVED_DASHBOARD = "zap:dashboard";

/** Remember this browser's private dashboard link so the header can take the seller back to it. */
export function rememberDashboard(url: string): void {
  try {
    localStorage.setItem(SAVED_DASHBOARD, url);
  } catch {}
}

/**
 * One header for every app page (not the landing page).
 * - `app`: sellers. Logo, Dashboard and Docs, plus an optional right-hand slot.
 * - `customer`: buyers (checkout, receipt, verify). Logo and a trust line, no seller links.
 */
export function SiteHeader({ variant = "app", right }: { variant?: "app" | "customer"; right?: ReactNode }) {
  const path = usePathname() ?? "";
  const [dash, setDash] = useState("/dashboard");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_DASHBOARD);
      if (saved && saved.startsWith("/dashboard")) setDash(saved);
    } catch {}
  }, []);
  const links = [
    { href: dash, label: "Dashboard", active: path.startsWith("/dashboard") },
    { href: "/docs", label: "Docs", active: path.startsWith("/docs") },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-5">
        <Link href="/" aria-label="Zap Payments home" className="-m-1 rounded-xl p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink">
          <Logo />
        </Link>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {right}
          {variant === "app" ? (
            <nav aria-label="Main" className="flex items-center gap-1">
              {links.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  aria-current={l.active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${l.active ? "bg-accent-soft text-ink" : "text-muted hover:bg-canvas hover:text-ink"}`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-good">
                <path d="M12 3 5 6v5c0 4.5 3 8.4 7 10 4-1.6 7-5.5 7-10V6l-7-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <span className="hidden sm:inline">Held in escrow on NEAR until the refund window ends</span>
              <span className="sm:hidden">Escrow on NEAR</span>
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
