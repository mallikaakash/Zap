import { createHash, randomBytes } from "node:crypto";
import { db, type Session } from "@uc/db";
import type { Kind } from "@uc/chain";
import type { Token } from "@uc/intents-adapter";
import { UserError } from "./errors";
import { fromMinor, isMinor, sumMinor } from "./money";
import { env, getAdapter, getChain, getConfig, getMockAdapter, simulationAllowed } from "./runtime";

export interface ScheduleItem {
  afterSecs: number;
  amount: string;
}

export interface CreateSessionInput {
  merchantId: string;
  amountUsd: string;
  kind?: Kind;
  schedule?: ScheduleItem[];
  orderRef?: string;
  product?: string;
  metadata?: Record<string, unknown>;
}

const KINDS: Kind[] = ["OneTime", "Subscription", "Schedule"];
const MAX_AMOUNT = 1_000_000_000_000n; // $1,000,000

/** `UC_TIME_SCALE` (never applied in live mode): schedule delays are divided by this. */
export function timeScale(): number {
  const n = Number(env().UC_TIME_SCALE);
  return getConfig().mode !== "live" && Number.isFinite(n) && n > 1 ? n : 1;
}

/** What goes on chain instead of the merchant's order id: no names, emails or product details. */
export function orderRefHash(merchantId: string, orderRef: string): string {
  return createHash("sha256").update(`${merchantId}:${orderRef}`).digest("hex");
}

/** Pseudo-asset for "Pay with USDC on NEAR": no swap, straight into the contract. */
export const DIRECT_ASSET = "near-usdc-direct";

const EVM = new Set(["eth", "pol", "base", "arb", "op", "bsc", "avax", "gnosis", "bera", "monad", "xlayer", "plasma"]);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Catch the obvious wrong-chain mistakes before money moves. Returns an error message or null. */
export function validateAddress(chain: string, address: string): string | null {
  const a = address.trim();
  if (EVM.has(chain)) return /^0x[0-9a-fA-F]{40}$/.test(a) ? null : "That does not look like an address on this chain (expected 0x followed by 40 hex characters)";
  if (chain === "sol") return BASE58.test(a) && a.length >= 32 && a.length <= 44 ? null : "That does not look like a Solana address";
  if (chain === "tron") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) ? null : "That does not look like a Tron address (they start with T)";
  if (chain === "btc") return /^(bc1[0-9a-z]{20,80}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a) ? null : "That does not look like a Bitcoin address";
  if (chain === "near") return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a) && a.length >= 2 && a.length <= 64 ? null : "That does not look like a NEAR account";
  return a.length >= 4 && a.length <= 128 && !/\s/.test(a) ? null : "Enter the address refunds should go back to";
}

export function checkoutUrl(sessionId: string): string {
  return `${getConfig().publicUrl}/checkout/${sessionId}`;
}

export async function createSession(input: CreateSessionInput): Promise<Session> {
  const merchantId = String(input.merchantId ?? "");
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new UserError(`Unknown merchant "${merchantId}"`, 404);
  if (!isMinor(input.amountUsd) || BigInt(input.amountUsd) <= 0n) throw new UserError("amountUsd must be a positive integer string in USDC minor units (6 dp)");
  if (BigInt(input.amountUsd) > MAX_AMOUNT) throw new UserError("Amount is above the per-payment limit");
  if (BigInt(input.amountUsd) < BigInt(merchant.minOrder)) throw new UserError(`This shop's minimum order is $${fromMinor(merchant.minOrder)}`);
  const kind = input.kind ?? "OneTime";
  if (!KINDS.includes(kind)) throw new UserError(`kind must be one of ${KINDS.join(", ")}`);

  let schedule: ScheduleItem[] = [];
  if (kind !== "OneTime") {
    schedule = (input.schedule ?? []).map((t) => ({ afterSecs: Number(t?.afterSecs), amount: String(t?.amount) }));
    if (schedule.length === 0 || schedule.length > 120) throw new UserError("schedule must have between 1 and 120 tranches");
    for (const t of schedule) {
      if (!Number.isInteger(t.afterSecs) || t.afterSecs < 0) throw new UserError("schedule[].afterSecs must be a non-negative integer");
      if (!isMinor(t.amount) || BigInt(t.amount) <= 0n) throw new UserError("schedule[].amount must be a positive integer string in minor units");
    }
    if (sumMinor(schedule.map((t) => t.amount)) !== input.amountUsd) throw new UserError("schedule amounts must add up to amountUsd");
    // Demo clock: on the local sandbox "30 days" can be squeezed into a minute so releases are watchable.
    const scale = timeScale();
    if (scale > 1) schedule = schedule.map((t) => ({ ...t, afterSecs: Math.ceil(t.afterSecs / scale) }));
    schedule.sort((a, b) => a.afterSecs - b.afterSecs);
  }

  const orderRef = (input.orderRef && String(input.orderRef).slice(0, 80)) || `ord_${randomBytes(6).toString("hex")}`;
  const existing = await db.session.findUnique({ where: { merchantId_orderRef: { merchantId, orderRef } } });
  if (existing) {
    // Same order opened again (e.g. customer closed the tab): reuse it if unpaid and identical.
    if (existing.amount === input.amountUsd && existing.kind === kind && ["created", "quoted", "expired"].includes(existing.status)) return existing;
    throw new UserError(`orderRef "${orderRef}" was already used for this merchant`, 409);
  }
  return db.session.create({
    data: {
      merchantId,
      orderRef,
      orderRefHash: orderRefHash(merchantId, orderRef),
      product: input.product ? String(input.product).slice(0, 120) : null,
      amount: input.amountUsd,
      kind,
      scheduleJson: JSON.stringify(schedule),
      metadataJson: JSON.stringify(input.metadata ?? {}),
    },
  });
}

let tokenCache: { at: number; tokens: Token[] } | undefined;

/** Assets a customer can pay with (cached for a minute). */
export async function listTokens(): Promise<Token[]> {
  if (tokenCache && Date.now() - tokenCache.at < 60_000) return tokenCache.tokens;
  const tokens = await getAdapter().listTokens();
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

function formatUnits(minor: string, decimals: number): string {
  const s = fromMinor(minor, decimals, 0).replace(/,/g, "");
  const [w, f = ""] = s.split(".");
  // keep it readable: at most 8 significant fraction digits
  const frac = f.slice(0, 8).replace(/0+$/, "");
  return frac ? `${w}.${frac}` : (w ?? "0");
}

export interface QuoteInput {
  /** A token's `assetId`, or `DIRECT_ASSET` to pay with USDC on NEAR. */
  originAsset: string;
  refundAddress: string;
  /** ed25519 public key (hex) made in the customer's browser. The private key never leaves it. */
  receiptKey: string;
}

export async function quoteSession(id: string, input: QuoteInput): Promise<Session> {
  const session = await db.session.findUnique({ where: { id } });
  if (!session) throw new UserError("Session not found", 404);
  if (!["created", "quoted", "expired"].includes(session.status)) throw new UserError("This payment has already started and can no longer be re-quoted", 409);
  if (!/^[0-9a-f]{64}$/.test(String(input.receiptKey))) throw new UserError("receiptKey must be a 64-character hex ed25519 public key");
  const refundAddress = String(input.refundAddress ?? "").trim();
  const c = getConfig();

  if (input.originAsset === DIRECT_ASSET) {
    const bad = validateAddress("near", refundAddress);
    if (bad) throw new UserError(bad);
    return db.session.update({
      where: { id },
      data: {
        status: "quoted",
        direct: true,
        originAsset: c.usdc,
        originSymbol: "USDC",
        originChain: "near",
        refundAddress,
        receiptKey: input.receiptKey,
        depositAddress: null,
        amountIn: session.amount,
        amountInFormatted: fromMinor(session.amount).replace(/,/g, ""),
        quoteDeadline: new Date(Date.now() + 30 * 60_000),
        quoteJson: null,
        error: null,
      },
    });
  }

  let tokens: Token[];
  try {
    tokens = await listTokens();
  } catch {
    throw new UserError("Coin prices are unavailable right now. You can still pay with USDC on NEAR.", 503);
  }
  const token = tokens.find((t) => t.assetId === input.originAsset);
  if (!token) throw new UserError("That coin is not supported");
  const bad = validateAddress(token.chain, refundAddress);
  if (bad) throw new UserError(bad);

  let quote;
  try {
    quote = await getAdapter().quotePay({ originAsset: token.assetId, amountUsd: session.amount, refundTo: refundAddress, recipientNear: c.receipts });
  } catch (e) {
    throw new UserError(`Could not get a quote: ${e instanceof Error ? e.message : String(e)}. You can still pay with USDC on NEAR.`, 502);
  }
  if (!quote.depositAddress) throw new UserError("The swap provider returned no deposit address", 502);

  return db.session.update({
    where: { id },
    data: {
      status: "quoted",
      direct: false,
      originAsset: token.assetId,
      originSymbol: token.symbol,
      originChain: token.chain,
      refundAddress,
      receiptKey: input.receiptKey,
      depositAddress: quote.depositAddress,
      depositMemo: quote.depositMemo ?? null,
      amountIn: quote.amountIn,
      amountInFormatted: formatUnits(quote.amountIn, token.decimals),
      quoteDeadline: new Date(quote.deadline),
      quoteJson: JSON.stringify(quote),
      error: null,
    },
  });
}

/** Mint args shared by both payment paths. */
export function mintArgsFor(s: Session, now: Date) {
  const schedule = (JSON.parse(s.scheduleJson) as ScheduleItem[]).map((t) => ({ at: new Date(now.getTime() + t.afterSecs * 1000).toISOString(), amount: t.amount }));
  return {
    merchantId: s.merchantId,
    orderRef: s.orderRefHash,
    amount: s.amount,
    kind: s.kind as Kind,
    schedule,
    refundTarget: { chain: s.originChain ?? "", asset: s.originAsset ?? "", address: s.refundAddress ?? "" },
    receiptKey: s.receiptKey ?? undefined,
  };
}

/**
 * Pretend the customer paid (never available in live mode).
 * - Swap path: the mock adapter "delivers" USDC to the contract; the worker then calls `mint_receipt`.
 * - Direct path: mock USDC is minted to a demo payer who does the real `ft_transfer_call`; the
 *   contract mints the receipt in `ft_on_transfer`.
 */
export async function simulatePayment(id: string): Promise<Session> {
  if (!simulationAllowed()) throw new UserError("Simulated payments are not available in this mode", 403);
  const session = await db.session.findUnique({ where: { id } });
  if (!session) throw new UserError("Session not found", 404);
  if (session.status !== "quoted") throw new UserError("Pick a coin and get a quote first", 409);
  // Claim the session first so a double click cannot pay twice.
  const claimed = await db.session.updateMany({ where: { id, status: "quoted" }, data: { status: "deposit_detected" } });
  if (claimed.count === 0) throw new UserError("Payment is already in progress", 409);
  try {
    if (session.direct) {
      const chain = getChain();
      const payer = getConfig().relayer;
      await chain.mintMockUsdc(payer, payer, session.amount);
      const tx = await chain.payDirect(payer, mintArgsFor(session, await chain.now()));
      // ft_transfer_call resolves to the amount the receiver kept: all of it when accepted, "0" when returned.
      if (tx.value !== session.amount) throw new Error(tx.events.find((e) => e.event === "payment_rejected")?.data.reason?.toString() ?? "the contract returned the payment");
    } else {
      const status = await getMockAdapter()!.simulatePayment(session.depositAddress!);
      if (status !== "SUCCESS") throw new Error(`swap ended as ${status}`);
    }
  } catch (e) {
    const m = `Simulated payment failed: ${e instanceof Error ? e.message : String(e)}`;
    await db.session.update({ where: { id }, data: { status: "quoted", error: m } });
    throw new UserError(m, 502);
  }
  return db.session.findUniqueOrThrow({ where: { id } });
}

/** What the checkout page polls. Never includes secrets. */
export function sessionView(s: Session & { merchant?: { name: string } | null }) {
  return {
    id: s.id,
    merchantId: s.merchantId,
    merchantName: s.merchant?.name ?? s.merchantId,
    orderRef: s.orderRef,
    product: s.product,
    amount: s.amount,
    kind: s.kind,
    schedule: JSON.parse(s.scheduleJson) as ScheduleItem[],
    status: s.status,
    originAsset: s.originAsset,
    originSymbol: s.originSymbol,
    originChain: s.originChain,
    refundAddress: s.refundAddress,
    direct: s.direct,
    payTo: s.direct ? { contract: getConfig().receipts, token: getConfig().usdc } : null,
    depositAddress: s.depositAddress,
    depositMemo: s.depositMemo,
    amountIn: s.amountIn,
    amountInFormatted: s.amountInFormatted,
    quoteDeadline: s.quoteDeadline?.toISOString() ?? null,
    receiptId: s.receiptId,
    error: s.error,
    createdAt: s.createdAt.toISOString(),
    paidAt: s.paidAt?.toISOString() ?? null,
    mode: getConfig().mode,
    canSimulate: simulationAllowed(),
    directAsset: DIRECT_ASSET,
  };
}

export async function getSession(id: string) {
  const s = await db.session.findUnique({ where: { id }, include: { merchant: true } });
  if (!s) throw new UserError("Session not found", 404);
  return sessionView(s);
}
