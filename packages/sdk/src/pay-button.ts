import { UcError } from "./errors";
import { CHECK, COINS, LOCK, SPINNER } from "./icons";
import { openCheckout, type CheckoutHandle, type ClosedDetail, type PaidDetail } from "./modal";
import { buildSessionBody, createSession, resolveApi, type CheckoutConfig, type Mode } from "./session";

export const TAG = "pay-button";
export const DEFAULT_LABEL = "Pay any way";

export interface ErrorDetail {
  code: string;
  message: string;
  status?: number;
}

type State = "idle" | "loading" | "open" | "success" | "error";

const CSS = `
:host{display:inline-block;vertical-align:middle;font-family:var(--uc-font,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);-webkit-text-size-adjust:100%}
:host([hidden]){display:none}
:host([size=sm]){--_h:36px;--_p:0 14px;--_f:13px}
:host([size=lg]){--_h:54px;--_p:0 28px;--_f:17px}
button{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:.55em;box-sizing:border-box;width:100%;min-height:var(--uc-height,var(--_h,44px));margin:0;padding:var(--uc-padding,var(--_p,0 20px));border:var(--uc-border,0);border-radius:var(--uc-radius,12px);background:var(--uc-color,#4F46E5);color:var(--uc-text-color,#fff);font-family:inherit;font-size:var(--uc-font-size,var(--_f,15px));font-weight:var(--uc-font-weight,600);line-height:1.2;letter-spacing:-.005em;white-space:nowrap;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;overflow:hidden;box-shadow:var(--uc-shadow,0 1px 2px rgba(15,23,42,.16),0 6px 16px -6px var(--uc-color,#4F46E5));transition:transform .16s ease,box-shadow .2s ease,filter .2s ease,background-color .2s ease,border-radius .2s ease}
button::before{content:"";position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,.16),rgba(255,255,255,0) 60%);pointer-events:none}
button:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:var(--uc-shadow-hover,0 2px 4px rgba(15,23,42,.16),0 12px 22px -8px var(--uc-color,#4F46E5))}
button:active{filter:brightness(.95);transform:translateY(0) scale(.985);transition-duration:.06s}
button:focus-visible{outline:2px solid var(--uc-focus-color,var(--uc-color,#4F46E5));outline-offset:2px}
button:disabled{cursor:not-allowed;opacity:.5;filter:saturate(.6);transform:none;box-shadow:none}
button[aria-busy=true]{cursor:progress;filter:none;transform:none}
.i{position:relative;display:inline-flex;flex:none;width:1.15em;height:1.15em}
.i svg{width:100%;height:100%}
.i:empty{display:none}
.l{position:relative}
.sp{animation:uc-spin .8s linear infinite}
.ck{animation:uc-pop .35s cubic-bezier(.2,.9,.3,1.4)}
.e{display:none;width:0;min-width:100%;margin-top:6px;font-size:12px;line-height:1.3;color:var(--uc-error-color,#dc2626);text-align:center}
.e:not(:empty){display:block}
@keyframes uc-spin{to{transform:rotate(360deg)}}
@keyframes uc-pop{from{transform:scale(.3);opacity:0}}
@media(prefers-reduced-motion:reduce){button{transition:none}button:hover,button:active{transform:none}.sp{animation-duration:1.6s}.ck{animation:none}}
`;

const HTML = `<style>${CSS}</style><button part="button" type="button"><span class="i" part="icon" aria-hidden="true"></span><span class="l" part="label"></span></button><span class="e" part="error" role="alert"></span>`;

const ICONS: Record<string, string> = { lock: LOCK, coins: COINS, none: "" };

/** Pick readable text for a #rgb / #rrggbb background; undefined if not a hex colour. */
export function contrastText(color: string): string | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  const hex = m?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? hex.replace(/./g, "$&$&") : hex;
  const n = parseInt(full, 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.62 ? "#0f172a" : "#fff";
}

function validColor(v: string): boolean {
  return typeof CSS_ !== "undefined" && typeof CSS_.supports === "function" ? CSS_.supports("color", v) : true;
}
const CSS_: { supports?: (p: string, v: string) => boolean } | undefined =
  typeof globalThis !== "undefined" ? (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS : undefined;

// SSR / non-DOM runtimes: importing this module must not throw.
const Base: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

export class PayButton extends Base {
  static readonly observedAttributes = [
    "merchant", "amount", "product", "order-ref", "mode", "months", "monthly", "tranches",
    "api", "metadata", "display", "label", "color", "text-color", "radius", "size", "icon", "disabled",
  ];

  #btn: HTMLButtonElement;
  #icon: HTMLElement;
  #label: HTMLElement;
  #err: HTMLElement;
  #state: State = "idle";
  #invalid: string | null = null;
  #lastLogged: string | null = null;
  #dirty = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #handle: CheckoutHandle | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open", delegatesFocus: true });
    root.innerHTML = HTML;
    this.#btn = root.querySelector("button") as HTMLButtonElement;
    this.#icon = root.querySelector(".i") as HTMLElement;
    this.#label = root.querySelector(".l") as HTMLElement;
    this.#err = root.querySelector(".e") as HTMLElement;
    this.#btn.addEventListener("click", () => void this.pay());
  }

  connectedCallback(): void {
    window.addEventListener("pageshow", this.#onPageShow);
    this.#render();
    this.#validate();
  }

  disconnectedCallback(): void {
    window.removeEventListener("pageshow", this.#onPageShow);
    clearTimeout(this.#timer);
  }

  attributeChangedCallback(): void {
    // Look and label update synchronously (live styler); config validation is
    // coalesced into one microtask so setting several attributes logs at most once.
    this.#render();
    if (!this.#dirty && this.isConnected) {
      this.#dirty = true;
      queueMicrotask(() => {
        if (this.#dirty) this.#validate();
      });
    }
  }

  /** Current validation error message, or null when the configuration is valid. */
  get error(): string | null {
    this.#validate();
    return this.#invalid;
  }

  /** `idle` | `loading` | `open` | `success` | `error`. */
  get state(): string {
    return this.#state;
  }

  /** The checkout description derived from the attributes. */
  get config(): CheckoutConfig & { api?: string } {
    const a = (n: string): string | undefined => this.getAttribute(n) ?? undefined;
    const cfg: CheckoutConfig & { api?: string } = { merchant: a("merchant") ?? "", mode: (a("mode") || "one-time") as Mode };
    const set = <K extends keyof typeof cfg>(k: K, v: (typeof cfg)[K] | undefined): void => {
      if (v !== undefined && v !== "") cfg[k] = v;
    };
    set("amount", a("amount"));
    set("product", a("product"));
    set("months", a("months"));
    set("monthly", a("monthly"));
    set("tranches", a("tranches"));
    set("orderRef", a("order-ref"));
    set("metadata", a("metadata"));
    set("api", a("api"));
    return cfg;
  }

  /** Close the checkout modal if this button opened one. */
  close(): void {
    this.#handle?.close();
  }

  /** Start checkout (same as a click). Resolves once the modal is open or the redirect started. */
  async pay(): Promise<void> {
    if (this.#state === "loading" || this.#state === "open" || this.#handle) return;
    this.#validate();
    if (this.#invalid || this.hasAttribute("disabled")) return;

    this.#set("loading");
    try {
      const session = await createSession(this.config);
      const handle = openCheckout(session.checkoutUrl, {
        display: this.getAttribute("display") === "redirect" ? "redirect" : "modal",
        sessionId: session.sessionId,
        returnFocus: this.#btn,
        accent: getComputedStyle(this.#btn).backgroundColor || undefined,
        onPaid: (d: PaidDetail) => {
          this.#set("success");
          this.#emit("uc:paid", d);
        },
        onClose: (d: ClosedDetail) => {
          this.#handle = null;
          if (this.#state === "success") this.#later(() => this.#set("idle"), 2500);
          else this.#set("idle");
          this.#emit("uc:closed", d);
        },
      });
      if (handle.display === "redirect") return; // stay in the loading state while the page navigates
      this.#handle = handle;
      this.#set("open");
    } catch (e) {
      const err = e instanceof UcError ? e : new UcError("network", e instanceof Error ? e.message : String(e));
      console.error(`[pay-button] ${err.message}`);
      this.#set("error", err.code === "invalid_config" ? "Checkout is misconfigured." : "Couldn't start checkout. Please try again.");
      this.#later(() => this.#state === "error" && this.#set("idle"), 5000);
      const detail: ErrorDetail = { code: err.code, message: err.message };
      if (err.status !== undefined) detail.status = err.status;
      this.#emit("uc:error", detail);
    }
  }

  #onPageShow = (ev: Event): void => {
    // Back/forward cache after a redirect checkout: don't come back stuck on "loading".
    if ((ev as PageTransitionEvent).persisted && this.#state === "loading") this.#set("idle");
  };

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #later(fn: () => void, ms: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(fn, ms);
  }

  #set(state: State, message = ""): void {
    clearTimeout(this.#timer);
    // Keep the width stable while the label/icon change.
    if (state === "idle") this.#btn.style.minWidth = "";
    else if (this.#state === "idle" && this.#btn.offsetWidth) this.#btn.style.minWidth = `${this.#btn.offsetWidth}px`;
    this.#state = state;
    this.#err.textContent = message;
    this.#render();
  }

  #validate(): void {
    this.#dirty = false;
    let msg: string | null = null;
    try {
      const { api, ...cfg } = this.config;
      const display = this.getAttribute("display");
      if (display && display !== "modal" && display !== "redirect") {
        throw new UcError("invalid_config", `\`display\` must be "modal" or "redirect", got ${JSON.stringify(display)}`);
      }
      resolveApi(api);
      buildSessionBody({ ...cfg, orderRef: cfg.orderRef ?? "-" });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    this.#invalid = msg;
    if (msg && msg !== this.#lastLogged) console.error(`[pay-button] invalid configuration: ${msg}`, this);
    this.#lastLogged = msg;
    this.#render();
  }

  #render(): void {
    const btn = this.#btn;
    const state = this.#state;

    // theme: attributes win over inherited --uc-* custom properties
    const color = (this.getAttribute("color") ?? "").trim();
    const okColor = color && validColor(color) ? color : "";
    const text = (this.getAttribute("text-color") ?? "").trim();
    const radius = (this.getAttribute("radius") ?? "").trim();
    this.#var("--uc-color", okColor);
    this.#var("--uc-text-color", text && validColor(text) ? text : okColor ? contrastText(okColor) ?? "" : "");
    this.#var("--uc-radius", /^\d+(\.\d+)?$/.test(radius) ? `${radius}px` : radius);

    const label = state === "success" ? "Paid" : this.getAttribute("label")?.trim() || DEFAULT_LABEL;
    if (this.#label.textContent !== label) this.#label.textContent = label;

    const icon =
      state === "loading" ? SPINNER : state === "success" ? CHECK : ICONS[this.getAttribute("icon") ?? "lock"] ?? LOCK;
    if (this.#icon.dataset.k !== icon) {
      this.#icon.dataset.k = icon;
      this.#icon.innerHTML = icon; // static, SDK-owned markup only
    }

    btn.dataset.state = state;
    btn.disabled = this.#invalid !== null || this.hasAttribute("disabled");
    if (state === "loading") btn.setAttribute("aria-busy", "true");
    else btn.removeAttribute("aria-busy");
    if (this.#invalid) btn.title = this.#invalid;
    else btn.removeAttribute("title");
  }

  #var(name: string, value: string): void {
    if (value) this.#btn.style.setProperty(name, value);
    else this.#btn.style.removeProperty(name);
  }
}

/** Define `<pay-button>` once. Safe under SSR and when the script is loaded twice. */
export function register(tag: string = TAG): void {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined") return;
  if (!customElements.get(tag)) customElements.define(tag, PayButton);
}
