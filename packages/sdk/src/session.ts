import { UcError } from "./errors";
import { usdToMinor } from "./money";

export type Mode = "one-time" | "subscription" | "schedule";
export type SessionKind = "OneTime" | "Subscription" | "Schedule";

export const DAY_SECS = 86_400;
/** A subscription "month" is a fixed 30 days. */
export const MONTH_SECS = 30 * DAY_SECS;

/** Merchant-facing tranche (the `tranches` attribute). */
export interface TrancheInput {
  afterDays: number;
  /** USD decimal string, e.g. "20" or "19.99". */
  amount: string;
}

/** Wire tranche. */
export interface ScheduleItem {
  /** Seconds after payment at which this tranche unlocks. */
  afterSecs: number;
  /** USDC minor units (6 dp) as an integer string. */
  amount: string;
}

/** Exact JSON body of `POST {api}/api/sessions`. Optional keys are omitted, never null. */
export interface SessionRequestBody {
  merchantId: string;
  /** Total, USDC minor units (6 dp) as an integer string, e.g. "49000000". */
  amountUsd: string;
  kind: SessionKind;
  schedule?: ScheduleItem[];
  orderRef: string;
  product?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionResponse {
  sessionId: string;
  checkoutUrl: string;
}

/** Human-friendly checkout description (mirrors the `<pay-button>` attributes). */
export interface CheckoutConfig {
  merchant: string;
  /** USD decimal. Required for one-time; optional (but must equal the total) otherwise. */
  amount?: string;
  product?: string;
  mode?: Mode;
  /** subscription: number of monthly payments. */
  months?: number | string;
  /** subscription: USD decimal per month. */
  monthly?: string;
  /** schedule: array (or JSON string) of `{ afterDays, amount }`. */
  tranches?: TrancheInput[] | string;
  orderRef?: string;
  /** Object or JSON string of an object. */
  metadata?: Record<string, unknown> | string;
}

export interface CreateSessionOptions extends CheckoutConfig {
  /** Base URL of the Universal Checkout host. Default: origin pay.js was loaded from. */
  api?: string;
  signal?: AbortSignal;
}

export interface Session extends SessionResponse {
  /** The body that was sent. */
  request: SessionRequestBody;
}

const KIND: Record<Mode, SessionKind> = {
  "one-time": "OneTime",
  subscription: "Subscription",
  schedule: "Schedule",
};
const MAX_TRANCHES = 120;

// Captured synchronously while pay.js executes; null when imported as a module.
const SCRIPT_SRC: string =
  typeof document !== "undefined" && document.currentScript instanceof HTMLScriptElement
    ? document.currentScript.src
    : "";

function bad(message: string): never {
  throw new UcError("invalid_config", message);
}

function money(field: string, value: unknown): bigint {
  let v = value;
  if (typeof v === "number" && Number.isSafeInteger(v)) v = String(v);
  if (typeof v !== "string") bad(`\`${field}\` must be a USD decimal string like "49" or "49.99"`);
  let minor: bigint;
  try {
    minor = BigInt(usdToMinor(v));
  } catch {
    bad(`\`${field}\` must be a USD decimal string like "49" or "49.99" (max 6 decimals), got ${JSON.stringify(v)}`);
  }
  if (minor <= 0n) bad(`\`${field}\` must be greater than zero`);
  return minor;
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** Base URL the SDK talks to when no `api` is given. */
export function defaultApi(): string {
  try {
    if (SCRIPT_SRC) return new URL(SCRIPT_SRC).origin;
  } catch {
    /* fall through */
  }
  return typeof location !== "undefined" ? location.origin : "";
}

/** Normalise an `api` value to an absolute http(s) base URL without trailing slash. */
export function resolveApi(api?: string | null): string {
  const raw = (api ?? "").trim() || defaultApi();
  let url: URL;
  try {
    url = new URL(raw, typeof location !== "undefined" ? location.href : undefined);
  } catch {
    bad(`\`api\` is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") bad(`\`api\` must be an http(s) URL, got ${JSON.stringify(raw)}`);
  return (url.origin + url.pathname).replace(/\/+$/, "");
}

export function generateOrderRef(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return `uc_${c.randomUUID().replace(/-/g, "")}`;
  let s = "";
  if (c && typeof c.getRandomValues === "function") {
    for (const b of c.getRandomValues(new Uint8Array(16))) s += b.toString(16).padStart(2, "0");
  } else {
    while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
  }
  return `uc_${s}`;
}

function parseTranches(input: CheckoutConfig["tranches"]): ScheduleItem[] {
  let list: unknown = input;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      bad('`tranches` is not valid JSON; expected e.g. [{"afterDays":0,"amount":"20"},{"afterDays":30,"amount":"29"}]');
    }
  }
  if (!Array.isArray(list) || list.length === 0) bad("`tranches` must be a non-empty array of { afterDays, amount }");
  if (list.length > MAX_TRANCHES) bad(`\`tranches\` supports at most ${MAX_TRANCHES} entries`);
  const out = list.map((t: unknown, i: number): ScheduleItem => {
    const o = (t ?? {}) as Record<string, unknown>;
    const days = o.afterDays;
    if (typeof days !== "number" || !Number.isFinite(days) || days < 0 || days > 36_500) {
      bad(`\`tranches[${i}].afterDays\` must be a number of days >= 0`);
    }
    return { afterSecs: Math.round(days * DAY_SECS), amount: money(`tranches[${i}].amount`, o.amount).toString() };
  });
  // Stable sort so the contract always receives tranches in unlock order.
  return out.sort((a, b) => a.afterSecs - b.afterSecs);
}

function parseMetadata(input: CheckoutConfig["metadata"]): Record<string, unknown> | undefined {
  if (!present(input)) return undefined;
  let v: unknown = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      bad("`metadata` is not valid JSON");
    }
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) bad("`metadata` must be a JSON object");
  return v as Record<string, unknown>;
}

/**
 * Validate a checkout config and build the exact `POST /api/sessions` body.
 * Throws UcError("invalid_config") with a message naming the offending field.
 */
export function buildSessionBody(cfg: CheckoutConfig): SessionRequestBody {
  const merchantId = typeof cfg.merchant === "string" ? cfg.merchant.trim() : "";
  if (!merchantId || /\s/.test(merchantId) || merchantId.length > 128) {
    bad("`merchant` is required (the merchant id, e.g. \"shop.testnet\")");
  }
  const mode: Mode = cfg.mode ?? "one-time";
  if (!(mode in KIND)) bad(`\`mode\` must be "one-time", "subscription" or "schedule", got ${JSON.stringify(mode)}`);

  const given = present(cfg.amount) ? money("amount", cfg.amount) : undefined;
  let total: bigint;
  let schedule: ScheduleItem[] | undefined;

  if (mode === "one-time") {
    if (given === undefined) bad("`amount` is required for mode=\"one-time\"");
    total = given;
  } else {
    if (mode === "subscription") {
      const months = typeof cfg.months === "number" ? cfg.months : /^\d{1,4}$/.test((cfg.months ?? "").trim()) ? Number(cfg.months) : NaN;
      if (!Number.isInteger(months) || months < 1 || months > MAX_TRANCHES) {
        bad(`\`months\` must be a whole number between 1 and ${MAX_TRANCHES} for mode="subscription"`);
      }
      const monthly = money("monthly", cfg.monthly).toString();
      schedule = Array.from({ length: months }, (_, i) => ({ afterSecs: i * MONTH_SECS, amount: monthly }));
    } else {
      schedule = parseTranches(cfg.tranches);
    }
    total = schedule.reduce((sum, t) => sum + BigInt(t.amount), 0n);
    if (given !== undefined && given !== total) {
      bad(`\`amount\` (${given} minor units) does not equal the ${mode} total (${total} minor units); fix it or omit \`amount\``);
    }
  }

  const body: SessionRequestBody = {
    merchantId,
    amountUsd: total.toString(),
    kind: KIND[mode],
    orderRef: (cfg.orderRef ?? "").trim() || generateOrderRef(),
  };
  if (schedule) body.schedule = schedule;
  const product = (cfg.product ?? "").trim();
  if (product) body.product = product;
  const metadata = parseMetadata(cfg.metadata);
  if (metadata) body.metadata = metadata;
  return body;
}

/** Resolve + validate a checkout URL returned by the backend (may be relative to `api`). */
export function resolveCheckoutUrl(checkoutUrl: string, base?: string): string {
  let url: URL;
  try {
    url = new URL(checkoutUrl, base || (typeof location !== "undefined" ? location.href : undefined));
  } catch {
    throw new UcError("bad_response", `Invalid checkoutUrl: ${JSON.stringify(checkoutUrl)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UcError("bad_response", `checkoutUrl must be http(s), got ${JSON.stringify(checkoutUrl)}`);
  }
  return url.toString();
}

/** Create a payment session: `POST {api}/api/sessions`. */
export async function createSession(opts: CreateSessionOptions): Promise<Session> {
  const api = resolveApi(opts.api);
  const request = buildSessionBody(opts);
  let res: Response;
  try {
    res = await fetch(`${api}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request),
      credentials: "omit",
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    throw new UcError("network", `Could not reach ${api}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = undefined;
  }
  const o = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (!res.ok) {
    const detail = typeof o.error === "string" ? o.error : typeof o.message === "string" ? o.message : res.statusText;
    throw new UcError("http", `Session request failed (${res.status})${detail ? `: ${detail}` : ""}`, res.status);
  }
  if (typeof o.sessionId !== "string" || !o.sessionId || typeof o.checkoutUrl !== "string" || !o.checkoutUrl) {
    throw new UcError("bad_response", "Session response must be { sessionId: string, checkoutUrl: string }");
  }
  return { sessionId: o.sessionId, checkoutUrl: resolveCheckoutUrl(o.checkoutUrl, `${api}/`), request };
}

export interface CheckoutLinkOptions extends CheckoutConfig {
  api?: string;
  /** `redirect`-style hosted page is implied; extra params are passed through untouched. */
  params?: Record<string, string>;
}

/**
 * Shareable link / QR payload: `{api}/pay?merchant=…&amount=…&product=…&mode=…`.
 * Amounts stay human-readable USD decimals; the hosted `/pay` route validates them
 * with `buildSessionBody`, creates a session and redirects to its checkout URL.
 */
export function checkoutLink(opts: CheckoutLinkOptions): string {
  const body = buildSessionBody({ ...opts, orderRef: opts.orderRef || "-" }); // validation only
  const mode: Mode = opts.mode ?? "one-time";
  const q = new URLSearchParams();
  q.set("merchant", body.merchantId);
  if (present(opts.amount)) q.set("amount", String(opts.amount).trim());
  if (body.product) q.set("product", body.product);
  q.set("mode", mode);
  if (mode === "subscription") {
    q.set("months", String(opts.months).trim());
    q.set("monthly", String(opts.monthly).trim());
  }
  if (mode === "schedule") {
    q.set("tranches", typeof opts.tranches === "string" ? JSON.stringify(JSON.parse(opts.tranches)) : JSON.stringify(opts.tranches));
  }
  const orderRef = (opts.orderRef ?? "").trim();
  if (orderRef) q.set("orderRef", orderRef);
  if (body.metadata) q.set("metadata", JSON.stringify(body.metadata));
  for (const [k, v] of Object.entries(opts.params ?? {})) q.set(k, v);
  return `${resolveApi(opts.api)}/pay?${q.toString()}`;
}
