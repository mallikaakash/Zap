"use client";

import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./landing.css";
import { AppProvider } from "./context";
import { Header, HeroFlow, Stats } from "./hero";
import { Cta, Dashboard, Developers, Footer, Gasless, Passes, Roadmap } from "./more";
import { AnyCoin, DropIn, Problem, Protections, Refunds, Verify } from "./sections";

export interface LandingProps {
  /** Origin of the checkout app. "" (default) when the landing is served by the app itself. */
  appUrl?: string;
  /** Merchant used by the real "pay $1" button. Default: the first registered merchant on appUrl. */
  demoMerchant?: string;
}

/** The Zap landing page (design: claude.ai artifact "Zap Payments — Hero", three artboards). */
export function Landing({ appUrl = "", demoMerchant }: LandingProps) {
  return (
    <AppProvider appUrl={appUrl} demoMerchant={demoMerchant}>
      <div className="z">
        <Header />
        <main>
          <HeroFlow />
          <Stats />
          <Problem />
          <DropIn />
          <AnyCoin />
          <Refunds />
          <Protections />
          <Verify />
          <Gasless />
          <Passes />
          <Dashboard />
          <Developers />
          <Roadmap />
          <Cta />
        </main>
        <Footer />
      </div>
    </AppProvider>
  );
}
