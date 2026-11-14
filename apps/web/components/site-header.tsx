"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client";
import { Logo } from "@/components/ui";

type Me = { id: string; name: string } | null;

/**
 * One header for every app page (not the landing page).
 * - `app`: sellers. Signed in: Dashboard, Docs, Sign out. Signed out: Docs, Log in, Create a shop.
 * - `customer`: buyers (checkout, receipt, verify). Logo and a trust line, no seller links.
 */
export function SiteHeader({ variant = "app", right }: { variant?: "app" | "customer"; right?: ReactNode }) {
  const path = usePathname() ?? "";
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    if (variant !== "app") return;
    api<{ merchant: Me }>("/api/auth/me")
      .then((r) => setMe(r.merchant))
      .catch(() => setMe(null));
  }, [variant]);

  const pill = (active: boolean) => `rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${active ? "bg-accent-soft text-ink" : "text-muted hover:bg-canvas hover:text-ink"}`;
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
              {me ? (
                <Link href="/dashboard" aria-current={path.startsWith("/dashboard") ? "page" : undefined} className={pill(path.startsWith("/dashboard"))}>
                  Dashboard
                </Link>
              ) : null}
              <Link href="/docs" aria-current={path.startsWith("/docs") ? "page" : undefined} className={pill(path.startsWith("/docs"))}>
                Docs
              </Link>
              {me ? (
                <button
                  type="button"
                  className={pill(false)}
                  title={`Signed in as ${me.id}`}
                  onClick={async () => {
                    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => {});
                    window.location.href = "/login";
                  }}
                >
                  Sign out
                </button>
              ) : me === null ? (
                <>
                  <Link href="/login" aria-current={path.startsWith("/login") ? "page" : undefined} className={pill(path.startsWith("/login"))}>
                    Log in
                  </Link>
                  <Link href="/dashboard" className="hidden rounded-full bg-ink px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-black sm:inline-block">
                    Create a shop
                  </Link>
                </>
              ) : null}
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
