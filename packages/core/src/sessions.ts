import { randomBytes } from "node:crypto";
import { db, type Session } from "@uc/db";
import type { Kind } from "@uc/chain";
import type { Token } from "@uc/intents-adapter";
import { UserError } from "./errors";
import { fromMinor, isMinor, sumMinor } from "./money";
import { env, getAdapter, getConfig, getMockAdapter, simulationAllowed } from "./runtime";

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

export function checkoutUrl(sessionId: string): string {
  return `${getConfig().publicUrl}/checkout/${sessionId}`;
}

export async function createSession(input: CreateSessionInput): Promise<Session> {
  const merchantId = String(input.merchantId ?? "");
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new UserError(`Unknown merchant "${merchantId}"`, 404);
  if (!isMinor(input.amountUsd) || BigInt(input.amountUsd) <= 0n) throw new UserError("amountUsd must be a positive integer string in USDC minor units (6 dp)");
  if (BigInt(input.amountUsd) > MAX_AMOUNT) throw new UserError("Amount is above the per-payment limit");
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
  originAsset: string;
  refundAddress: string;
  /** sha256(secret_0) hex, made in the customer's browser. */
  secretHash: string;
}

export async function quoteSession(id: string, input: QuoteInput): Promise<Session> {
  const session = await db.session.findUnique({ where: { id } });
  if (!session) throw new UserError("Session not found", 404);
  if (!["created", "quoted", "expired"].includes(session.status)) throw new UserError("This payment has already started and can no longer be re-quoted", 409);
  if (!/^[0-9a-f]{64}$/.test(String(input.secretHash))) throw new UserError("secretHash must be 64 hex characters");
  const refundAddress = String(input.refundAddress ?? "").trim();
  if (refundAddress.length < 2 || refundAddress.length > 128) throw new UserError("Enter the address refunds should go back to");
  const token = (await listTokens()).find((t) => t.assetId === input.originAsset);
  if (!token) throw new UserError("That coin is not supported");

  let quote;
  try {
    quote = await getAdapter().quotePay({ originAsset: token.assetId, amountUsd: session.amount, refundTo: refundAddress, recipientNear: getConfig().receipts });
  } catch (e) {
    throw new UserError(`Could not get a quote: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  if (!quote.depositAddress) throw new UserError("The swap provider returned no deposit address", 502);

  return db.session.update({
    where: { id },
    data: {
      status: "quoted",
      originAsset: token.assetId,
      originSymbol: token.symbol,
      originChain: token.chain,
      refundAddress,
      secretHash: input.secretHash,
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

/** Pretend the customer sent the coins (mock swaps only). The settlement worker then mints the receipt. */
export async function simulatePayment(id: string): Promise<Session> {
  if (!simulationAllowed()) throw new UserError("Simulated payments are not available in this mode", 403);
  const session = await db.session.findUnique({ where: { id } });
  if (!session) throw new UserError("Session not found", 404);
  if (session.status !== "quoted" || !session.depositAddress) throw new UserError("Pick a coin and get a quote first", 409);
  // Claim the session first so a double click cannot deliver twice.
  const claimed = await db.session.updateMany({ where: { id, status: "quoted" }, data: { status: "deposit_detected" } });
  if (claimed.count === 0) throw new UserError("Payment is already in progress", 409);
  try {
    const status = await getMockAdapter()!.simulatePayment(session.depositAddress);
    if (status !== "SUCCESS") throw new Error(`swap ended as ${status}`);
  } catch (e) {
    await db.session.update({ where: { id }, data: { status: "quoted", error: `Simulated payment failed: ${e instanceof Error ? e.message : String(e)}` } });
    throw new UserError(`Simulated payment failed: ${e instanceof Error ? e.message : String(e)}`, 502);
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
  };
}

export async function getSession(id: string) {
  const s = await db.session.findUnique({ where: { id }, include: { merchant: true } });
  if (!s) throw new UserError("Session not found", 404);
  return sessionView(s);
}
