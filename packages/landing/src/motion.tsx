"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Enables hero entrance once the page has painted. */
export function useMotionReady() {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(reduced);
  useEffect(() => {
    if (reduced) {
      setReady(true);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, [reduced]);
  return { ready, reduced };
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  /** Extra wait after the block intersects (ms). */
  delay?: number;
  /** Vertical travel in px while fading in. */
  y?: number;
  id?: string;
};

/** Scroll-triggered fade + rise. Children stay in the DOM for SEO and a11y. */
export function Reveal({ children, className = "", as: Tag = "div", delay = 0, y = 26, id }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const style = { "--z-reveal-delay": `${delay}ms`, "--z-reveal-y": `${y}px` } as CSSProperties;

  return (
    <Tag ref={ref} id={id} className={`z-reveal${visible ? " is-in" : ""}${className ? ` ${className}` : ""}`} style={style}>
      {children}
    </Tag>
  );
}