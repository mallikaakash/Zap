"use client";

import { useApp } from "./context";

/** Sandbox / mainnet disclosure on the home hero only (fine print, not global chrome). */
export function LandingModeKicker() {
  const { mode } = useApp();
  if (mode === "live") return null;

  return (
    <p className="z-landing-kicker" role="note">
      <span className="z-landing-kicker-dot" aria-hidden />
      <span>Not live on NEAR mainnet</span>
      {mode === "local" ? (
        <>
          <span className="z-landing-kicker-sep" aria-hidden>
            ·
          </span>
          <span>Sandbox demo, no real money</span>
        </>
      ) : null}
    </p>
  );
}