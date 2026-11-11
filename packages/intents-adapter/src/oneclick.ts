/**
 * OneClickAdapter — NEAR Intents 1Click API client.
 *
 * Field names below were checked against
 * https://1click.chaindefuser.com/docs/v0/openapi.yaml and against live
 * `GET /v0/tokens` + `POST /v0/quote` (`dry: true`) responses on 2026-11-11.
 * See README.md "What was verified".
 *
 * A non-dry quote creates a REAL deposit address on mainnet. Construct with
 * `dry: true` unless you intend to move real money (see `createAdapter`).
 */
import {
  DEFAULT_DEADLINE_MINS,
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
import { deadlineFromNow, isUintString, numberToDecimalString, parseAmount } from './util';

export const ONECLICK_BASE_URL = 'https://1click.chaindefuser.com';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OneClickAdapterOptions {
  /** Default `https://1click.chaindefuser.com`. */
  baseUrl?: string;
  /** Sent as `Authorization: Bearer <jwt>` (lower 1Click fee). */
  jwt?: string;
  /** Sent as `X-API-Key` (the OpenAPI lists this as the recommended scheme; JWT bearer as legacy). */
  apiKey?: string;
  /** When true EVERY quote is sent with `dry: true`: no deposit address, nothing can be paid. */
  dry?: boolean;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetch?: FetchLike;
  /** USDC-on-NEAR asset id. Default `USDC_NEAR_ASSET_ID`. */
  usdcNearAssetId?: string;
  /** Slippage in basis points (integer, 100 = 1%). Default 100. */
  slippageBps?: number;
  /** How long 1Click waits for solver quotes. Default 3000. */
  quoteWaitingTimeMs?: number;
  /** Optional `referral` tag (lowercase). */
  referral?: string;
  /** Per-request timeout. Default 20000. */
  timeoutMs?: number;
  now?: () => number;
}

/** 1Click `QuoteRequest` — the 12 fields the OpenAPI marks required, plus the optional ones we send. */
export interface OneClickQuoteRequest {
  dry: boolean;
  swapType: 'EXACT_INPUT' | 'EXACT_OUTPUT' | 'FLEX_INPUT' | 'ANY_INPUT';
  slippageTolerance: number;
  originAsset: string;
  depositType: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  recipient: string;
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  deadline: string;
  quoteWaitingTimeMs?: number;
  referral?: string;
}

/** 1Click `QuoteResponse.quote`. `depositAddress`, `deadline`, `timeWhenInactive` are absent on dry quotes. */
export interface OneClickQuote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
}

export interface OneClickQuoteResponse {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: OneClickQuoteRequest & Record<string, unknown>;
  quote: OneClickQuote;
}

export interface OneClickTxDetails {
  hash: string;
  explorerUrl: string;
}

/** 1Click `GetExecutionStatusResponse`. */
export interface OneClickStatusResponse {
  correlationId: string;
  status: SwapStatus;
  updatedAt: string;
  quoteResponse: OneClickQuoteResponse;
  swapDetails: {
    intentHashes: string[];
    nearTxHashes: string[];
    originChainTxHashes: OneClickTxDetails[];
    destinationChainTxHashes: OneClickTxDetails[];
    amountIn?: string;
    amountOut?: string;
    refundedAmount?: string;
    refundReason?: string;
    depositedAmount?: string;
    [k: string]: unknown;
  };
}

export class OneClickError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'OneClickError';
  }
}

export class OneClickAdapter implements IntentsAdapter {
  readonly baseUrl: string;
  readonly dry: boolean;
  readonly usdcNearAssetId: string;
  protected readonly opts: OneClickAdapterOptions;

  constructor(opts: OneClickAdapterOptions = {}) {
    this.opts = opts;
    this.baseUrl = (opts.baseUrl ?? ONECLICK_BASE_URL).replace(/\/+$/, '');
    this.dry = opts.dry ?? false;
    this.usdcNearAssetId = opts.usdcNearAssetId ?? USDC_NEAR_ASSET_ID;
    const bps = opts.slippageBps ?? 100;
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new Error(`slippageBps must be an integer 0..10000, got ${bps}`);
    }
  }

  async listTokens(): Promise<Token[]> {
    const rows = await this.request<unknown>('GET', '/v0/tokens');
    if (!Array.isArray(rows)) throw new OneClickError('1Click /v0/tokens did not return an array', 200, '/v0/tokens', rows);
    return rows.map((r: Record<string, unknown>) => {
      const t: Token = {
        assetId: String(r['assetId']),
        symbol: String(r['symbol']),
        chain: String(r['blockchain']),
        decimals: Number(r['decimals']),
        priceUsd: numberToDecimalString(Number(r['price'])),
      };
      if (typeof r['contractAddress'] === 'string') t.contractAddress = r['contractAddress'];
      if (typeof r['priceUpdatedAt'] === 'string') t.priceUpdatedAt = r['priceUpdatedAt'];
      return t;
    });
  }

  /** originAsset (customer's chain) -> exact USDC on NEAR to `recipientNear`. */
  async quotePay(p: QuotePayParams): Promise<Quote> {
    parseAmount(p.amountUsd, 'amountUsd');
    const quote = await this.quote('pay', {
      swapType: 'EXACT_OUTPUT',
      originAsset: p.originAsset,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: this.usdcNearAssetId,
      amount: p.amountUsd,
      refundTo: p.refundTo,
      refundType: 'ORIGIN_CHAIN',
      recipient: p.recipientNear,
      recipientType: 'DESTINATION_CHAIN',
      deadline: deadlineFromNow(this.now(), p.deadlineMins, DEFAULT_DEADLINE_MINS),
    });
    // The merchant must receive exactly what was asked for; refuse anything else.
    if (quote.amountOut !== p.amountUsd) {
      throw new Error(`1Click EXACT_OUTPUT quote returned amountOut ${quote.amountOut}, expected ${p.amountUsd}`);
    }
    return quote;
  }

  /** Exact USDC on NEAR (deposited from NEAR with ft_transfer) -> targetAsset to targetAddress. */
  async quoteRefund(p: QuoteRefundParams): Promise<Quote> {
    parseAmount(p.amountUsdc, 'amountUsdc');
    return this.quote('refund', {
      swapType: 'EXACT_INPUT',
      originAsset: this.usdcNearAssetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: p.targetAsset,
      amount: p.amountUsdc,
      refundTo: p.refundToNear,
      refundType: 'ORIGIN_CHAIN',
      recipient: p.targetAddress,
      recipientType: 'DESTINATION_CHAIN',
      deadline: deadlineFromNow(this.now(), p.deadlineMins, DEFAULT_DEADLINE_MINS),
    });
  }

  async status(depositAddress: string, memo?: string): Promise<SwapStatus | string> {
    return (await this.statusDetails(depositAddress, memo)).status;
  }

  /** Full `GET /v0/status` body (tx hashes + explorer links live in `swapDetails`). */
  async statusDetails(depositAddress: string, memo?: string): Promise<OneClickStatusResponse> {
    const qs = new URLSearchParams({ depositAddress });
    if (memo) qs.set('depositMemo', memo);
    const body = await this.request<OneClickStatusResponse>('GET', `/v0/status?${qs.toString()}`);
    if (!body || typeof body.status !== 'string') {
      throw new OneClickError('1Click /v0/status response has no status', 200, '/v0/status', body);
    }
    return body;
  }

  async submitDeposit(depositAddress: string, txHash: string, opts: SubmitDepositOptions = {}): Promise<void> {
    const body: Record<string, string> = { txHash, depositAddress };
    if (opts.nearSenderAccount) body['nearSenderAccount'] = opts.nearSenderAccount;
    if (opts.memo) body['memo'] = opts.memo;
    await this.request('POST', '/v0/deposit/submit', body);
  }

  private async quote(
    kind: QuoteKind,
    fields: Omit<OneClickQuoteRequest, 'dry' | 'slippageTolerance' | 'quoteWaitingTimeMs' | 'referral'>,
  ): Promise<Quote> {
    const req: OneClickQuoteRequest = {
      dry: this.dry,
      slippageTolerance: this.opts.slippageBps ?? 100,
      ...fields,
      quoteWaitingTimeMs: this.opts.quoteWaitingTimeMs ?? 3000,
    };
    if (this.opts.referral) req.referral = this.opts.referral;

    const res = await this.request<OneClickQuoteResponse>('POST', '/v0/quote', req);
    const q = res?.quote;
    if (!q || !isUintString(q.amountIn) || !isUintString(q.amountOut)) {
      throw new OneClickError('1Click /v0/quote response is missing quote.amountIn/amountOut', 200, '/v0/quote', res);
    }
    if (!this.dry && (!q.depositAddress || !q.deadline)) {
      throw new OneClickError('1Click non-dry quote has no depositAddress/deadline', 200, '/v0/quote', res);
    }
    const out: Quote = {
      id: res.correlationId,
      kind,
      dry: this.dry,
      originAsset: req.originAsset,
      destinationAsset: req.destinationAsset,
      depositAddress: q.depositAddress ?? '',
      amountIn: q.amountIn,
      amountOut: q.amountOut,
      // Dry quotes carry no deadline; fall back to the one we requested.
      deadline: q.deadline ?? req.deadline,
      raw: res,
    };
    if (q.depositMemo) out.depositMemo = q.depositMemo;
    if (isUintString(q.minAmountIn)) out.minAmountIn = q.minAmountIn;
    if (isUintString(q.minAmountOut)) out.minAmountOut = q.minAmountOut;
    if (typeof q.timeEstimate === 'number') out.timeEstimateSecs = q.timeEstimate;
    return out;
  }

  protected now(): number {
    return (this.opts.now ?? Date.now)();
  }

  protected async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const doFetch: FetchLike = this.opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.opts.jwt) headers['authorization'] = `Bearer ${this.opts.jwt}`;
    if (this.opts.apiKey) headers['x-api-key'] = this.opts.apiKey;

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000) };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await doFetch(this.baseUrl + path, init);
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : String(text).slice(0, 300);
      throw new OneClickError(`1Click ${method} ${path.split('?')[0]} failed (${res.status}): ${msg}`, res.status, path, parsed);
    }
    return parsed as T;
  }
}

export interface TidepoolAdapterOptions extends OneClickAdapterOptions {
  /** URL of a running Tidepool sandbox (required). */
  baseUrl: string;
}

/**
 * EXPERIMENTAL. Tidepool (https://github.com/Watchmeecryt/tidepool) claims the
 * same API shape as 1Click; this is OneClickAdapter pointed at it.
 * VERIFY: never run against a real Tidepool instance — only the URL plumbing is tested.
 */
export class TidepoolAdapter extends OneClickAdapter {
  readonly experimental = true;

  constructor(opts: TidepoolAdapterOptions) {
    if (!opts?.baseUrl) throw new Error('TidepoolAdapter needs a baseUrl (TIDEPOOL_URL)');
    super(opts);
  }
}
