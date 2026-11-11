import { UcError } from "./errors";
import { CLOSE, LOCK, SPINNER } from "./icons";
import { resolveCheckoutUrl } from "./session";

/** `data.source` of every message the hosted checkout posts to its parent. */
export const MESSAGE_SOURCE = "universal-checkout";

export type CheckoutMessageType = "uc:paid" | "uc:close" | "uc:resize";

/** Shape the hosted checkout page sends with `window.parent.postMessage(msg, "*")`. */
export interface CheckoutMessage {
  source: typeof MESSAGE_SOURCE;
  type: CheckoutMessageType;
  sessionId?: string;
  receiptId?: string;
  receiptUrl?: string;
  /** uc:resize — content height in CSS px. */
  height?: number;
}

export interface PaidDetail {
  sessionId: string | undefined;
  receiptId: string | undefined;
  receiptUrl: string | undefined;
}

export interface ClosedDetail {
  sessionId: string | undefined;
  paid: boolean;
}

export interface OpenCheckoutOptions {
  /** `modal` (default) opens an iframe overlay; `redirect` navigates the page. */
  display?: "modal" | "redirect";
  sessionId?: string;
  /** Accessible name of the dialog. */
  title?: string;
  /** Accent colour for the modal's loading spinner. */
  accent?: string;
  /** Element to focus when the modal closes (default: previously focused element). */
  returnFocus?: HTMLElement | null;
  onPaid?: (detail: PaidDetail) => void;
  onClose?: (detail: ClosedDetail) => void;
}

export interface CheckoutHandle {
  readonly display: "modal" | "redirect";
  readonly paid: boolean;
  close(): void;
}

/** Indirection so tests (and exotic hosts) can intercept navigation. */
export const nav = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

/** Append `embed=1`, preserving any existing query string and fragment. */
export function embedUrl(checkoutUrl: string): string {
  const u = new URL(checkoutUrl);
  u.searchParams.set("embed", "1");
  return u.toString();
}

const MODAL_TAG = "uc-checkout-modal";
const HEADER_PX = 53;

const CSS = `
:host{position:fixed;inset:0;z-index:var(--uc-z-index,2147483000);display:block;font-family:var(--uc-font,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);color-scheme:light;-webkit-text-size-adjust:100%}
.r{position:absolute;inset:0;display:grid;place-items:center}
.b{position:absolute;inset:0;background:var(--uc-backdrop,rgba(15,23,42,.58));-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity .22s ease}
.d{position:relative;display:flex;flex-direction:column;box-sizing:border-box;width:min(var(--uc-modal-width,460px),calc(100vw - 32px));height:min(var(--h,var(--uc-modal-height,720px)),calc(100vh - 48px));background:var(--uc-modal-bg,#fff);border-radius:var(--uc-modal-radius,20px);box-shadow:0 32px 72px -16px rgba(15,23,42,.5),0 0 0 1px rgba(15,23,42,.06);overflow:hidden;opacity:0;transform:translateY(18px) scale(.97);transition:opacity .2s ease,transform .3s cubic-bezier(.2,.9,.3,1.12),height .2s ease}
@supports(height:100dvh){.d{height:min(var(--h,var(--uc-modal-height,720px)),calc(100dvh - 48px))}}
.r:not(.o){pointer-events:none}
.o .b{opacity:1}
.o .d{opacity:1;transform:none}
.h{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;height:52px;box-sizing:border-box;padding:0 10px 0 18px;border-bottom:1px solid rgba(15,23,42,.08);font-size:13px;line-height:1;color:#475569}
.t{display:flex;align-items:center;gap:7px;min-width:0}
.t svg{flex:none;width:14px;height:14px;color:#16a34a}
.t b{font-weight:600;color:#0f172a;white-space:nowrap}
.t span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b}
.x{flex:none;display:grid;place-items:center;width:32px;height:32px;margin:0;padding:0;border:0;border-radius:50%;background:transparent;color:#475569;cursor:pointer;transition:background .15s ease,color .15s ease,transform .1s ease;-webkit-tap-highlight-color:transparent}
.x svg{width:16px;height:16px}
.x:hover{background:rgba(15,23,42,.07);color:#0f172a}
.x:active{transform:scale(.92)}
.x:focus-visible{outline:2px solid var(--a,#4F46E5);outline-offset:1px}
.f{position:relative;flex:1;min-height:0}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;transition:opacity .25s ease}
.l{position:absolute;inset:0;display:grid;place-items:center;color:var(--a,#4F46E5)}
.l svg{width:28px;height:28px;animation:uc-spin .8s linear infinite}
.ok iframe{opacity:1}
.ok .l{display:none}
.s{position:absolute;width:1px;height:1px;overflow:hidden;outline:0}
@keyframes uc-spin{to{transform:rotate(360deg)}}
@media(max-width:520px){.d{width:100vw;height:100vh;border-radius:0;transform:translateY(28px)}
@supports(height:100dvh){.d{height:100dvh}}
.h{padding-top:env(safe-area-inset-top,0);height:calc(52px + env(safe-area-inset-top,0px))}}
@media(prefers-reduced-motion:reduce){.b,.d,.x,iframe{transition:none}.d{transform:none}.l svg{animation-duration:1.6s}}
`;

const HTML = `<style>${CSS}</style><div class="r"><div class="b" part="backdrop"></div><div class="s" tabindex="0"></div><div class="d" part="dialog" role="dialog" aria-modal="true"><div class="h" part="header"><div class="t">${LOCK}<b>Secure checkout</b><span></span></div><button class="x" type="button" aria-label="Close checkout">${CLOSE}</button></div><div class="f"><div class="l">${SPINNER}</div></div></div><div class="s" tabindex="0"></div></div>`;

let current: { close(): void } | null = null;

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function redirect(url: string): CheckoutHandle {
  nav.assign(url);
  return { display: "redirect", paid: false, close() {} };
}

/**
 * Open a hosted checkout URL. Returns a handle; in `redirect` mode (or when a
 * modal cannot be created) the page navigates to `checkoutUrl` instead.
 */
export function openCheckout(checkoutUrl: string, opts: OpenCheckoutOptions = {}): CheckoutHandle {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new UcError("invalid_config", "openCheckout() needs a browser");
  }
  const url = resolveCheckoutUrl(checkoutUrl);
  if (opts.display === "redirect" || !document.body || typeof HTMLElement.prototype.attachShadow !== "function") {
    return redirect(url);
  }
  try {
    return openModal(url, opts);
  } catch (e) {
    console.error("[universal-checkout] could not open the checkout modal, redirecting instead", e);
    return redirect(url);
  }
}

function openModal(url: string, opts: OpenCheckoutOptions): CheckoutHandle {
  current?.close();

  const origin = new URL(url).origin;
  const sessionId = opts.sessionId;
  const prevFocus = opts.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const host = document.createElement(MODAL_TAG);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = HTML;
  const q = <T extends Element>(sel: string): T => {
    const el = shadow.querySelector<T>(sel);
    if (!el) throw new Error(`modal template is missing ${sel}`);
    return el;
  };
  const root = q<HTMLElement>(".r");
  const dialog = q<HTMLElement>(".d");
  const frameBox = q<HTMLElement>(".f");
  const closeBtn = q<HTMLButtonElement>(".x");
  const sentinels = shadow.querySelectorAll<HTMLElement>(".s");

  dialog.setAttribute("aria-label", opts.title ?? "Secure checkout");
  q<HTMLElement>(".t span").textContent = new URL(url).host;
  if (opts.accent) dialog.style.setProperty("--a", opts.accent);

  const frame = document.createElement("iframe");
  frame.title = opts.title ?? "Secure checkout";
  frame.setAttribute("allow", "clipboard-write; payment");
  frame.setAttribute("referrerpolicy", "origin");
  frame.addEventListener("load", () => frameBox.classList.add("ok"));
  frame.src = embedUrl(url);
  frameBox.appendChild(frame);

  let paid = false;
  let closed = false;

  // --- page state we must restore -------------------------------------------------
  const de = document.documentElement;
  const prevOverflow = de.style.overflow;
  const prevPadding = de.style.paddingRight;
  const gap = window.innerWidth - de.clientWidth;
  de.style.overflow = "hidden";
  if (gap > 0) de.style.paddingRight = `${gap}px`;

  const inerted: Element[] = [];
  for (const el of Array.from(document.body.children)) {
    if (!el.hasAttribute("inert")) {
      el.setAttribute("inert", "");
      inerted.push(el);
    }
  }

  // --- listeners --------------------------------------------------------------------
  const onMessage = (ev: MessageEvent): void => {
    if (ev.origin !== origin) return;
    const d = ev.data as Partial<CheckoutMessage> | null;
    if (!d || typeof d !== "object" || d.source !== MESSAGE_SOURCE) return;
    if (ev.source && frame.contentWindow && ev.source !== frame.contentWindow) return;
    if (sessionId && typeof d.sessionId === "string" && d.sessionId !== sessionId) return;
    if (d.type === "uc:paid") {
      if (paid) return;
      paid = true;
      opts.onPaid?.({
        sessionId: sessionId ?? d.sessionId,
        receiptId: typeof d.receiptId === "string" ? d.receiptId : undefined,
        receiptUrl: typeof d.receiptUrl === "string" ? d.receiptUrl : undefined,
      });
    } else if (d.type === "uc:close") {
      close();
    } else if (d.type === "uc:resize" && typeof d.height === "number" && Number.isFinite(d.height)) {
      dialog.style.setProperty("--h", `${Math.max(320, Math.min(4000, Math.ceil(d.height))) + HEADER_PX}px`);
    }
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };

  function close(): void {
    if (closed) return;
    closed = true;
    if (current === handle) current = null;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("keydown", onKey, true);
    de.style.overflow = prevOverflow;
    de.style.paddingRight = prevPadding;
    for (const el of inerted) el.removeAttribute("inert");
    root.classList.remove("o");
    setTimeout(() => host.remove(), reducedMotion() ? 0 : 280);
    try {
      prevFocus?.focus({ preventScroll: true });
    } catch {
      /* element may be gone */
    }
    opts.onClose?.({ sessionId, paid });
  }

  const handle: CheckoutHandle = {
    display: "modal",
    get paid() {
      return paid;
    },
    close,
  };

  window.addEventListener("message", onMessage);
  document.addEventListener("keydown", onKey, true);
  q<HTMLElement>(".b").addEventListener("click", close);
  closeBtn.addEventListener("click", close);
  // Focus trap: the rest of the page is inert; sentinels keep Tab cycling inside the dialog.
  sentinels[0]?.addEventListener("focus", () => frame.focus());
  sentinels[1]?.addEventListener("focus", () => closeBtn.focus());

  document.body.appendChild(host);
  current = handle;
  void root.offsetWidth; // commit the start styles so the open transition runs
  root.classList.add("o");
  closeBtn.focus({ preventScroll: true });
  return handle;
}
