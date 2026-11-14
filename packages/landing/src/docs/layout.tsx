"use client";

import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import "../landing.css";
import { AppProvider, useApp } from "../context";
import { SiteHeader } from "../site-header";
import { DOC_NAV } from "./nav";

export interface DocsLayoutProps {
  children: ReactNode;
  appUrl?: string;
  demoMerchant?: string;
}

function DocsSidebar() {
  const pathname = usePathname() ?? "/docs";
  const { href } = useApp();

  return (
    <aside className="z-docs-aside" aria-label="Doc sections">
      <nav className="z-docs-sidenav">
        <ul>
          {DOC_NAV.map((item) => {
            const path = href(item.href);
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <a href={path} className={active ? "on" : undefined} aria-current={active ? "page" : undefined}>
                  {item.title}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

function DocsShell({ children }: { children: ReactNode }) {
  const { href } = useApp();
  return (
    <div className="z z-docs">
      <SiteHeader section="docs" />
      <div className="z-wrap z-docs-shell">
        <DocsSidebar />
        <main className="z-docs-main">{children}</main>
      </div>
      <footer className="z-docs-foot">
        <div className="z-wrap">
          <a href={href("/")} className="z-muted" style={{ fontSize: 14, textDecoration: "none" }}>
            ← Back to Zap home
          </a>
        </div>
      </footer>
    </div>
  );
}

export function DocsLayout({ children, appUrl = "", demoMerchant }: DocsLayoutProps) {
  return (
    <AppProvider appUrl={appUrl} demoMerchant={demoMerchant}>
      <DocsShell>{children}</DocsShell>
    </AppProvider>
  );
}