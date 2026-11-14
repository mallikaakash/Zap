"use client";

import { useEffect } from "react";
import { LogoMark } from "./brand";

export function Preloader({ exiting, onExitEnd }: { exiting: boolean; onExitEnd: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(onExitEnd, 420);
    return () => clearTimeout(t);
  }, [exiting, onExitEnd]);

  return (
    <div className={`z-preload${exiting ? " exiting" : ""}`} role="status" aria-live="polite" aria-busy={!exiting}>
      <LogoMark size={26} className="z-preload-mark" />
      <span className="z-sr">Loading Zap Payments</span>
    </div>
  );
}