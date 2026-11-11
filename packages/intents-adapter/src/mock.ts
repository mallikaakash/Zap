/**
 * MockAdapter — deterministic, network-free stand-in for 1Click, used in
 * `local` and `testnet` modes (NEAR Intents has no testnet).
 *
 * Deposit addresses it returns are FAKE. Never show them as payable on a real
 * chain: anything sent to them is lost. Payment happens via `simulatePayment`.
 * The adapter is chain-agnostic: on-chain effects (minting mock USDC to the
 * receipt contract, logging the fake refund) are done by injected callbacks.
 */
import { MOCK_TOKENS } from './mock-tokens';
import {
  DEFAULT_DEADLINE_MINS,
  USDC_DECIMALS,
  USDC_NEAR_ASSET_ID,
  type IntentsAdapter,
  type Quote,
  type QuoteKind,
  type QuotePayParams,
  type QuoteRefundParams,
  type SubmitDepositOptions,
  type SwapStatus,
  type Token,
} from './types';
import { ceilDiv, deadlineFromNow, isUintString, parseAmount, parseDecimal, pick, seededBytes } from './util';

const PRICE_SCALE = 8;
const BPS = 10_000n;

/** What MockAdapter asks an external price source for. */
export interface PriceRequest {
  kind: QuoteKind;
  originAsset: string;
  destinationAsset: string;
  /** pay: exact USDC out wanted. refund: exact USDC in. Minor units. */
  amount: string;
  /** Refund address on the origin chain. */
  refundTo: string;
  /** Recipient address on the destination chain. */
  recipient: string;
}

export interface PriceResult {
  amountIn: string;
  amountOut: string;
  minAmountIn?: string;
  minAmountOut?: string;
}

/**
 * Optional hook for real prices (testnet mode wires it to a 1Click DRY quote).
 * Throwing, or returning null/undefined/garbage, falls back to the fixed table.
 */
export type PriceSource = (req: PriceRequest) => Promise<PriceResult | null | undefined>;

export interface MockRecord {
  quote: Quote;
  /** pay: the NEAR recipient (receipt contract). refund: the customer's target address. */
  recipient: string;
  refundTo: string;
  status: SwapStatus;
  createdAt: string;
  updatedAt: string;
  depositTxHash?: string;
}

/** JSON-serialisable snapshot of the in-memory store. */
export interface MockState {
  version: 1;
  counter: number;
  records: Record<string, MockRecord>;
}

/**
 * Per-record persistence, so two processes (web app + settlement worker) can
 * share mock swaps through a DB table keyed by deposit address.
 */
export interface MockStore {
  get(depositAddress: string): Promise<MockRecord | undefined>;
  put(record: MockRecord): Promise<void>;
}

export interface DeliverEvent {
  quote: Quote;
  /** NEAR account that must receive the USDC (the receipt contract). */
  recipientNear: string;
  /** USDC minor units to deliver. */
  amountOut: string;
}

export interface RefundDeliveredEvent {
  quote: Quote;
  targetAsset: string;
  targetAddress: string;
  /** Minor units of `targetAsset` "delivered". */
  amountOut: string;
}

export interface MockAdapterOptions {
  /** Token/price table. Default `MOCK_TOKENS`. */
  tokens?: readonly Token[];
  /** Simulated swap fee in basis points. Default 30 (0.3%). */
  feeBps?: number;
  /** Seed for fake deposit addresses. Default "uc-mock". */
  seed?: string;
  usdcNearAssetId?: string;
  priceSource?: PriceSource;
  /** Max time to wait for `priceSource` before using the table. Default 8000. */
  priceSourceTimeoutMs?: number;
  /** Called by `simulatePayment`: put `amountOut` USDC on `recipientNear` (e.g. mint mock USDC on chain). */
  onDeliver?: (e: DeliverEvent) => Promise<void>;
  /** Called by `simulateRefundDelivery`: record the fake cross-chain refund. */
  onRefundDelivered?: (e: RefundDeliveredEvent) => Promise<void>;
  /** External store shared between processes. Default: in-memory. */
  store?: MockStore;
  now?: () => number;
}

const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'pol', 'bsc', 'op', 'avax', 'gnosis', 'bera', 'monad', 'xlayer', 'scroll', 'plasma']);
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const HEX = '0123456789abcdef';

/** Fake but plausibly-shaped deposit address for a chain. */
export function fakeDepositAddress(chain: string, entropy: string): string {
  const bytes = seededBytes(`${chain}|${entropy}`, 64);
  if (chain === 'sol') return pick(BASE58, bytes.slice(0, 44));
  if (chain === 'btc') return 'bc1q' + pick(BECH32, bytes.slice(0, 38));
  if (chain === 'tron') return 'T' + pick(BASE58, bytes.slice(0, 33));
  if (chain === 'near') return pick(HEX, bytes); // 64-hex implicit account
  if (EVM_CHAINS.has(chain)) return '0x' + pick(HEX, bytes.slice(0, 40));
  return '0x' + pick(HEX, bytes.slice(0, 40));
}

export class MockAdapter implements IntentsAdapter {
  readonly isMock = true;
  readonly usdcNearAssetId: string;
  private readonly tokens: readonly Token[];
  private readonly feeBps: bigint;
  private readonly seed: string;
  private readonly opts: MockAdapterOptions;
  private readonly memory = new Map<string, MockRecord>();
  private readonly inFlight = new Set<string>();
  private counter = 0;

  constructor(opts: MockAdapterOptions = {}) {
    this.opts = opts;
    this.tokens = opts.tokens ?? MOCK_TOKENS;
    this.seed = opts.seed ?? 'uc-mock';
    this.usdcNearAssetId = opts.usdcNearAssetId ?? USDC_NEAR_ASSET_ID;
    const fee = opts.feeBps ?? 30;
    if (!Number.isInteger(fee) || fee < 0 || fee >= 10_000) throw new Error(`feeBps must be an integer 0..9999, got ${fee}`);
    this.feeBps = BigInt(fee);
  }

  async listTokens(): Promise<Token[]> {
    return this.tokens.map((t) => ({ ...t }));
  }

  async quotePay(p: QuotePayParams): Promise<Quote> {
    const amountOut = parseAmount(p.amountUsd, 'amountUsd');
    const origin = this.token(p.originAsset, 'originAsset');
    if (!p.recipientNear) throw new Error('recipientNear is required');
    if (!p.refundTo) throw new Error('refundTo is required');
    const deadline = deadlineFromNow(this.now(), p.deadlineMins, DEFAULT_DEADLINE_MINS);

    // amountIn = ceil(USDC out valued in origin tokens), plus the simulated fee, rounded up.
    const base = ceilDiv(
      amountOut * 10n ** BigInt(origin.decimals) * this.usdcPrice(),
      this.price(origin) * 10n ** BigInt(USDC_DECIMALS),
    );
    let amountIn = ceilDiv(base * (BPS + this.feeBps), BPS);
    let minAmountIn = amountIn;
    let pricing: 'table' | 'source' = 'table';

    const live = await this.askPriceSource({
      kind: 'pay',
      originAsset: p.originAsset,
      destinationAsset: this.usdcNearAssetId,
      amount: p.amountUsd,
      refundTo: p.refundTo,
      recipient: p.recipientNear,
    });
    // Only trust a source that still delivers the exact amount the merchant asked for.
    if (live && live.amountOut === p.amountUsd) {
      amountIn = BigInt(live.amountIn);
      minAmountIn = live.minAmountIn && isUintString(live.minAmountIn) ? BigInt(live.minAmountIn) : amountIn;
      pricing = 'source';
    }

    return this.createRecord({
      kind: 'pay',
      chain: origin.chain,
      originAsset: p.originAsset,
      destinationAsset: this.usdcNearAssetId,
      amountIn: amountIn.toString(),
      minAmountIn: minAmountIn.toString(),
      amountOut: p.amountUsd,
      minAmountOut: p.amountUsd,
      deadline,
      recipient: p.recipientNear,
      refundTo: p.refundTo,
      pricing,
    });
  }

  async quoteRefund(p: QuoteRefundParams): Promise<Quote> {
    const amountIn = parseAmount(p.amountUsdc, 'amountUsdc');
    const target = this.token(p.targetAsset, 'targetAsset');
    if (!p.targetAddress) throw new Error('targetAddress is required');
    if (!p.refundToNear) throw new Error('refundToNear is required');
    const deadline = deadlineFromNow(this.now(), p.deadlineMins, DEFAULT_DEADLINE_MINS);

    // amountOut = floor(USDC in valued in target tokens), minus the simulated fee, rounded down.
    const gross =
      (amountIn * 10n ** BigInt(target.decimals) * this.usdcPrice()) /
      (this.price(target) * 10n ** BigInt(USDC_DECIMALS));
    let amountOut = (gross * (BPS - this.feeBps)) / BPS;
    let minAmountOut = amountOut;
    let pricing: 'table' | 'source' = 'table';

    const live = await this.askPriceSource({
      kind: 'refund',
      originAsset: this.usdcNearAssetId,
      destinationAsset: p.targetAsset,
      amount: p.amountUsdc,
      refundTo: p.refundToNear,
      recipient: p.targetAddress,
    });
    if (live && live.amountIn === p.amountUsdc) {
      amountOut = BigInt(live.amountOut);
      minAmountOut = live.minAmountOut && isUintString(live.minAmountOut) ? BigInt(live.minAmountOut) : amountOut;
      pricing = 'source';
    }
    if (amountOut <= 0n) throw new Error(`refund of ${p.amountUsdc} USDC minor units is too small to deliver any ${target.symbol}`);

    return this.createRecord({
      kind: 'refund',
      chain: 'near', // the refund leg is funded from NEAR
      originAsset: this.usdcNearAssetId,
      destinationAsset: p.targetAsset,
      amountIn: p.amountUsdc,
      minAmountIn: p.amountUsdc,
      amountOut: amountOut.toString(),
      minAmountOut: minAmountOut.toString(),
      deadline,
      recipient: p.targetAddress,
      refundTo: p.refundToNear,
      pricing,
    });
  }

  /** Unknown addresses throw (1Click answers 404). Unpaid quotes past their deadline report FAILED. */
  async status(depositAddress: string, _memo?: string): Promise<SwapStatus> {
    return this.effectiveStatus(await this.mustGet(depositAddress));
  }

  /** Records the deposit tx hash and moves PENDING_DEPOSIT -> KNOWN_DEPOSIT_TX. */
  async submitDeposit(depositAddress: string, txHash: string, _opts?: SubmitDepositOptions): Promise<void> {
    const rec = await this.mustGet(depositAddress);
    if (this.effectiveStatus(rec) !== 'PENDING_DEPOSIT') return;
    await this.save({ ...rec, depositTxHash: txHash, status: 'KNOWN_DEPOSIT_TX' });
  }

  /**
   * Pretend the customer paid a PAY quote: PENDING_DEPOSIT -> PROCESSING ->
   * `onDeliver` -> SUCCESS. Idempotent: a quote that already succeeded is not
   * delivered twice. A quote past its deadline becomes REFUNDED and nothing is
   * delivered. If `onDeliver` throws, the status is rolled back and the error
   * rethrown so the caller can retry.
   */
  async simulatePayment(depositAddress: string): Promise<SwapStatus> {
    return this.settle(depositAddress, 'pay', async (rec) => {
      await this.opts.onDeliver?.({ quote: rec.quote, recipientNear: rec.recipient, amountOut: rec.quote.amountOut });
    });
  }

  /** Same as `simulatePayment`, for a REFUND quote; calls `onRefundDelivered`. */
  async simulateRefundDelivery(depositAddress: string): Promise<SwapStatus> {
    return this.settle(depositAddress, 'refund', async (rec) => {
      await this.opts.onRefundDelivered?.({
        quote: rec.quote,
        targetAsset: rec.quote.destinationAsset,
        targetAddress: rec.recipient,
        amountOut: rec.quote.amountOut,
      });
    });
  }

  /** Stored record (quote, recipient, raw status), or undefined. */
  async getRecord(depositAddress: string): Promise<MockRecord | undefined> {
    const rec = await this.store().get(depositAddress);
    return rec ? structuredClone(rec) : undefined;
  }

  /** Snapshot of the in-memory store. Not available with a custom `store` (that store IS the state). */
  exportState(): MockState {
    if (this.opts.store) throw new Error('exportState() is only for the in-memory store; a custom MockStore already persists state');
    return structuredClone({ version: 1 as const, counter: this.counter, records: Object.fromEntries(this.memory) });
  }

  /** Replaces the in-memory store with a snapshot from `exportState()` (object or its JSON string). */
  importState(state: MockState | string): void {
    if (this.opts.store) throw new Error('importState() is only for the in-memory store; a custom MockStore already persists state');
    const s = (typeof state === 'string' ? JSON.parse(state) : state) as MockState;
    if (!s || s.version !== 1 || typeof s.records !== 'object' || s.records === null) {
      throw new Error('importState: not a MockAdapter state (expected { version: 1, counter, records })');
    }
    this.memory.clear();
    for (const [addr, rec] of Object.entries(s.records)) this.memory.set(addr, structuredClone(rec));
    this.counter = Math.max(this.counter, Number.isInteger(s.counter) ? s.counter : 0);
  }

  // ---- internals ----

  private async settle(depositAddress: string, kind: QuoteKind, deliver: (rec: MockRecord) => Promise<void>): Promise<SwapStatus> {
    const rec = await this.mustGet(depositAddress);
    if (rec.quote.kind !== kind) {
      throw new Error(`${depositAddress} is a ${rec.quote.kind} quote; use ${rec.quote.kind === 'pay' ? 'simulatePayment' : 'simulateRefundDelivery'}`);
    }
    if (this.inFlight.has(depositAddress)) return 'PROCESSING';
    if (rec.status !== 'PENDING_DEPOSIT' && rec.status !== 'KNOWN_DEPOSIT_TX') return rec.status;
    if (this.expired(rec)) {
      // The deposit arrived after the deadline: the funds go back to refundTo.
      await this.save({ ...rec, status: 'REFUNDED' });
      return 'REFUNDED';
    }
    this.inFlight.add(depositAddress);
    try {
      await this.save({ ...rec, status: 'PROCESSING' });
      try {
        await deliver(rec);
      } catch (err) {
        await this.save({ ...rec });
        throw err;
      }
      await this.save({ ...rec, status: 'SUCCESS' });
      return 'SUCCESS';
    } finally {
      this.inFlight.delete(depositAddress);
    }
  }

  private async createRecord(a: {
    kind: QuoteKind;
    chain: string;
    originAsset: string;
    destinationAsset: string;
    amountIn: string;
    minAmountIn: string;
    amountOut: string;
    minAmountOut: string;
    deadline: string;
    recipient: string;
    refundTo: string;
    pricing: 'table' | 'source';
  }): Promise<Quote> {
    const n = ++this.counter;
    const nowIso = new Date(this.now()).toISOString();
    const entropy = [this.seed, n, nowIso, a.kind, a.originAsset, a.destinationAsset, a.amountIn, a.amountOut, a.recipient].join('|');
    const depositAddress = fakeDepositAddress(a.chain, entropy);
    const quote: Quote = {
      id: `mock-${pick('0123456789abcdef', seededBytes('id|' + entropy, 16))}`,
      kind: a.kind,
      dry: false,
      originAsset: a.originAsset,
      destinationAsset: a.destinationAsset,
      depositAddress,
      amountIn: a.amountIn,
      minAmountIn: a.minAmountIn,
      amountOut: a.amountOut,
      minAmountOut: a.minAmountOut,
      deadline: a.deadline,
      timeEstimateSecs: 5,
      raw: { mock: true, pricing: a.pricing, feeBps: Number(this.feeBps), recipient: a.recipient, refundTo: a.refundTo },
    };
    await this.store().put({ quote, recipient: a.recipient, refundTo: a.refundTo, status: 'PENDING_DEPOSIT', createdAt: nowIso, updatedAt: nowIso });
    return structuredClone(quote);
  }

  private async askPriceSource(req: PriceRequest): Promise<PriceResult | undefined> {
    const source = this.opts.priceSource;
    if (!source) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), this.opts.priceSourceTimeoutMs ?? 8000);
      });
      const r = await Promise.race([source(req), timeout]);
      if (!r || !isUintString(r.amountIn) || !isUintString(r.amountOut)) return undefined;
      if (BigInt(r.amountIn) <= 0n || BigInt(r.amountOut) <= 0n) return undefined;
      return r;
    } catch {
      return undefined; // offline / rejected: the fixed table is the answer
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private token(assetId: string, name: string): Token {
    const t = this.tokens.find((x) => x.assetId === assetId);
    if (!t) throw new Error(`${name}: unknown asset "${assetId}" (not in the mock token table; see listTokens())`);
    return t;
  }

  private price(t: Token): bigint {
    const p = parseDecimal(t.priceUsd, PRICE_SCALE);
    if (p <= 0n) throw new Error(`token ${t.assetId} has no usable price`);
    return p;
  }

  private usdcPrice(): bigint {
    const usdc = this.tokens.find((x) => x.assetId === this.usdcNearAssetId);
    return usdc ? this.price(usdc) : 10n ** BigInt(PRICE_SCALE);
  }

  private expired(rec: MockRecord): boolean {
    return this.now() > Date.parse(rec.quote.deadline);
  }

  private effectiveStatus(rec: MockRecord): SwapStatus {
    if (this.inFlight.has(rec.quote.depositAddress)) return 'PROCESSING';
    if ((rec.status === 'PENDING_DEPOSIT' || rec.status === 'KNOWN_DEPOSIT_TX') && this.expired(rec)) return 'FAILED';
    return rec.status;
  }

  private async mustGet(depositAddress: string): Promise<MockRecord> {
    const rec = await this.store().get(depositAddress);
    if (!rec) throw new Error(`Deposit address ${depositAddress} not found`);
    return rec;
  }

  private async save(rec: MockRecord): Promise<void> {
    await this.store().put({ ...rec, updatedAt: new Date(this.now()).toISOString() });
  }

  private store(): MockStore {
    return (
      this.opts.store ?? {
        get: async (addr) => this.memory.get(addr),
        put: async (rec) => {
          this.memory.set(rec.quote.depositAddress, structuredClone(rec));
        },
      }
    );
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }
}

export function isMockAdapter(a: unknown): a is MockAdapter {
  return a instanceof MockAdapter;
}
