"use client";

import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./landing.css";
import { AppProvider } from "./context";
import { Header, HeroFlow } from "./hero";
import { Dashboard, Footer, Gasless } from "./more";
import { Reveal, useMotionReady } from "./motion";
import { AnyCoin, DropIn, Problem, Protections, Refunds, Verify } from "./sections";

export interface LandingProps {
  /** Origin of the checkout app. "" (default) when the landing is served by the app itself. */
  appUrl?: string;
  /** Merchant used by the real "pay $1" button. Default: the first registered merchant on appUrl. */
  demoMerchant?: string;
}

/** The Zap landing page (design: claude.ai artifact "Zap Payments — Hero", three artboards). */
export function Landing({ appUrl = "", demoMerchant }: LandingProps) {
  const { ready, reduced } = useMotionReady();
  const motion = reduced ? " z-motion-reduced" : ready ? " z-motion-on" : " z-motion";

  return (
    <AppProvider appUrl={appUrl} demoMerchant={demoMerchant}>
      <div className={`z${motion}`}>
        <Header />
        <main>
          <HeroFlow />
          <Reveal>
            <Problem />
          </Reveal>
          <Reveal delay={40}>
            <DropIn />
          </Reveal>
          <Reveal>
            <AnyCoin />
          </Reveal>
          <Reveal>
            <Refunds />
          </Reveal>
          <Reveal>
            <Protections />
          </Reveal>
          <Reveal>
            <Verify />
          </Reveal>
          <Reveal>
            <Gasless />
          </Reveal>
          <Reveal>
            <Dashboard />
          </Reveal>
        </main>
        <Reveal y={16}>
          <Footer />
        </Reveal>
      </div>
    </AppProvider>
  );
}
