"use client";

import { createElement, useEffect } from "react";
import { useApp } from "./context";

const loading = new Map<string, Promise<void>>();

/** Load pay.js from the checkout host, exactly as a merchant's site would. */
function loadPayScript(src: string): Promise<void> {
  if (customElements.get("pay-button")) return Promise.resolve();
  let p = loading.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("pay.js failed to load"));
      document.head.appendChild(s);
    });
    loading.set(src, p);
  }
  return p;
}

/** The real <pay-button> web component, loaded from the checkout host. */
export function RealPayButton(props: { merchant: string; amount: string; product: string; label?: string; color?: string; radius?: string; size?: string }) {
  const { href, appUrl } = useApp();
  useEffect(() => {
    void loadPayScript(href("/pay.js")).catch(() => {});
  }, [href]);
  return createElement("pay-button", { ...props, ...(appUrl ? { api: appUrl } : {}) });
}
