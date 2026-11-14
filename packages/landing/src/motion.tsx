"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Preloader } from "./preloader";

const BOOT_MS = 720;

function shouldSkipBoot() {
  if (typeof window === "undefined") return true;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  return new URLSearchParams(window.location.search).has("still");
}

async function waitForBootAssets() {
  const min = new Promise<void>((r) => window.setTimeout(r, BOOT_MS));
  const fonts = document.fonts?.ready ?? Promise.resolve();
  const mark = new Promise<void>((r) => {
    const img = new Image();
    img.onload = img.onerror = () => r();
    img.src = "/brand/mark.png";
  });
  await Promise.all([min, fonts, mark]);
}

type BootPhase = "pending" | "preload" | "exit" | "done";

/** Preloader gate, then unlock hero entrance stagger. */
export function useLandingBoot() {
  const [phase, setPhase] = useState<BootPhase>("pending");

  useEffect(() => {
    if (shouldSkipBoot()) {
      setPhase("done");
      return;
    }
    setPhase("preload");
    let cancelled = false;
    void (async () => {
      await waitForBootAssets();
      if (!cancelled) setPhase("exit");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onExitEnd = useCallback(() => setPhase("done"), []);

  return {
    booted: phase === "done",
    exiting: phase === "exit",
    showPreloader: phase === "pending" || phase === "preload" || phase === "exit",
    onExitEnd,
  };
}

/** After boot, one frame later start the staged hero reveal. */
export function usePageEnter(armed: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!armed) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReady(true);
      return;
    }
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, [armed]);
  return ready;
}

export function LandingBootScreen({ exiting, onExitEnd }: { exiting: boolean; onExitEnd: () => void }) {
  return <Preloader exiting={exiting} onExitEnd={onExitEnd} />;
}

/** Fade sections in as they scroll into view; optional `.z-stagger-children` for card grids. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`z-reveal${inView ? " in" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}