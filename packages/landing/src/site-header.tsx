"use client";

import { useApp } from "./context";
import { LogoWordmark } from "./brand";
import { IconDocs, IconGitHub, IconLaunch } from "./icons";
import { LIVE_DEMO_PATH, ZAP_GITHUB } from "./site-links";

export type SiteSection = "home" | "docs";

/** Product chrome shared by marketing and developer docs. */
export function SiteHeader({ section = "home" }: { section?: SiteSection }) {
  const { href } = useApp();
  const home = href("/");

  return (
    <header className="z-header z-enter-item" style={{ ["--enter-i" as string]: 0 }}>
      <a href={section === "home" ? "#top" : home} className="z-brand">
        <LogoWordmark height={32} className="z-logo-wordmark-header" />
      </a>
      <nav aria-label="Primary" className="z-nav">
        <a className="z-navlink z-nav-live" href={href(LIVE_DEMO_PATH)} title="A real $0.10 checkout on NEAR mainnet: pay with any coin, then ask for a refund">
          <span className="z-live-dot" aria-hidden="true" />
          Check Live Demo
        </a>
        <a className={`z-navlink${section === "docs" ? " on" : ""}`} href={href("/docs")} aria-current={section === "docs" ? "page" : undefined}>
          <IconDocs size={15} />
          Docs
        </a>
        <a className="z-navlink" href={ZAP_GITHUB} target="_blank" rel="noopener noreferrer">
          <IconGitHub size={15} />
          GitHub
        </a>
        <a className="z-btn ink sm z-nav-cta" href={href("/dashboard")}>
          Get started
          <IconLaunch size={14} />
        </a>
      </nav>
    </header>
  );
}