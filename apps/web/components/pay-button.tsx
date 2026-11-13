"use client";

import { createElement, useEffect, useRef } from "react";

let loading: Promise<void> | null = null;

/** Load the same `pay.js` a merchant's site would load. */
export function loadPayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (customElements.get("pay-button")) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/pay.js";
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("pay.js failed to load"));
    document.head.appendChild(s);
  });
  return loading;
}

export interface PayButtonProps {
  merchant: string;
  amount?: string;
  product?: string;
  productId?: string;
  mode?: "one-time" | "subscription" | "schedule";
  months?: string;
  monthly?: string;
  tranches?: string;
  label?: string;
  color?: string;
  radius?: string;
  size?: string;
  icon?: string;
  metadata?: string;
  onPaid?: (detail: { sessionId: string; receiptId?: string; receiptUrl?: string }) => void;
}

/** React wrapper around the real `<pay-button>` web component (attributes in, DOM events out). */
export function PayButton({ onPaid, ...attrs }: PayButtonProps) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    void loadPayScript();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || !onPaid) return;
    const h = (e: Event) => onPaid((e as CustomEvent).detail);
    el.addEventListener("uc:paid", h);
    return () => el.removeEventListener("uc:paid", h);
  }, [onPaid]);
  const { productId, ...rest } = attrs;
  const clean = Object.fromEntries(Object.entries({ ...rest, "product-id": productId }).filter(([, v]) => v !== undefined && v !== ""));
  return createElement("pay-button", { ref, ...clean });
}
