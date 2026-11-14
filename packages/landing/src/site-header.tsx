"use client";

import { useApp } from "./context";
import { LogoWordmark } from "./brand";

export type SiteSection = "home" | "docs";

/** Product chrome shared by marketing and developer docs. */
export function SiteHeader({ section = "home" }: { section?: SiteSection }) {
  const { href } = useApp();
  const home = href("/");
  const how = section === "home" ? "#top" : `${home}#top`;
  const start = section === "home" ? "#start" : `${home}#start`;

  return (
    <header className="z-wrap z-header">
      <a href={section === "home" ? "#top" : home} className="z-brand">
        <LogoWordmark height={68} className="z-logo-wordmark-header" />
      </a>
      <nav aria-label="Primary" className="z-nav">
        <a className="z-navlink" href={how}>
          How it works
        </a>
        <a className={`z-navlink${section === "docs" ? " on" : ""}`} href={href("/docs")} aria-current={section === "docs" ? "page" : undefined}>
          Docs
        </a>
        <a className="z-navlink" href={href("/dashboard")}>
          Dashboard
        </a>
        <a className="z-btn ink sm" href={start}>
          Get started
        </a>
      </nav>
    </header>
  );
}