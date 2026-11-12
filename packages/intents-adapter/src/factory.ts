import { MockAdapter, type MockAdapterOptions, type PriceSource } from './mock';
import { OneClickAdapter, TidepoolAdapter, type FetchLike } from './oneclick';

export type UcMode = 'local' | 'testnet' | 'live';

/** The env vars `createAdapter` reads. */
export interface AdapterEnv {
  UC_MODE?: string;
  ONECLICK_BASE_URL?: string;
  ONECLICK_JWT?: string;
  TIDEPOOL_URL?: string;
  CONFIRM_REAL_MONEY?: string;
  [key: string]: string | undefined;
}

export interface CreateAdapterOverrides {
  /** Injectable fetch for the 1Click / Tidepool clients. */
  fetch?: FetchLike;
  /** Extra MockAdapter options (onDeliver, onRefundDelivered, store, feeBps, ...). */
  mock?: MockAdapterOptions;
}

export function parseMode(value: string | undefined): UcMode {
  const mode = (value ?? '').trim() || 'local';
  if (mode === 'local' || mode === 'testnet' || mode === 'live') return mode;
  throw new Error(`UC_MODE must be "local", "testnet" or "live" (got "${mode}")`);
}

/**
 * A MockAdapter `priceSource` backed by 1Click DRY quotes: real market numbers,
 * no deposit address, no money. Refuses an adapter that is not in dry mode.
 *
 * 1Click rejects quotes whose NEAR-side account does not exist on mainnet
 * (observed live: a `*.testnet` recipient gets HTTP 400), so the NEAR account is
 * replaced by `nearPlaceholder` — it only affects validation, not the price.
 */
export function dryQuotePriceSource(adapter: OneClickAdapter, opts: { nearPlaceholder?: string } = {}): PriceSource {
  if (!adapter.dry) throw new Error('dryQuotePriceSource requires a OneClickAdapter constructed with dry: true');
  const near = opts.nearPlaceholder ?? 'example.near';
  return async (req) => {
    const q =
      req.kind === 'pay'
        ? await adapter.quotePay({ originAsset: req.originAsset, amountUsd: req.amount, refundTo: req.refundTo, recipientNear: near })
        : await adapter.quoteRefund({ amountUsdc: req.amount, targetAsset: req.destinationAsset, targetAddress: req.recipient, refundToNear: near });
    const out: { amountIn: string; amountOut: string; minAmountIn?: string; minAmountOut?: string } = {
      amountIn: q.amountIn,
      amountOut: q.amountOut,
    };
    if (q.minAmountIn) out.minAmountIn = q.minAmountIn;
    if (q.minAmountOut) out.minAmountOut = q.minAmountOut;
    return out;
  };
}

function processEnv(): AdapterEnv {
  return (globalThis as { process?: { env?: AdapterEnv } }).process?.env ?? {};
}

/**
 * Picks the adapter for the current run mode.
 *
 * - `local` (default): MockAdapter, fixed price table, no network.
 * - `testnet`: MockAdapter priced by 1Click dry quotes (table on any failure);
 *   or the experimental TidepoolAdapter when `TIDEPOOL_URL` is set.
 * - `live`: real OneClickAdapter — ONLY when `CONFIRM_REAL_MONEY === 'yes'`.
 */
export function createAdapter(env: AdapterEnv = processEnv(), overrides: CreateAdapterOverrides = {}): MockAdapter | OneClickAdapter {
  const mode = parseMode(env.UC_MODE);
  const base: { baseUrl?: string; jwt?: string; fetch?: FetchLike } = {};
  if (env.ONECLICK_BASE_URL) base.baseUrl = env.ONECLICK_BASE_URL;
  if (env.ONECLICK_JWT) base.jwt = env.ONECLICK_JWT;
  if (overrides.fetch) base.fetch = overrides.fetch;

  if (mode === 'live') {
    if (env.CONFIRM_REAL_MONEY !== 'yes') {
      throw new Error(
        'UC_MODE=live talks to the real NEAR Intents 1Click API and moves REAL money. ' +
          'Refusing to start: set CONFIRM_REAL_MONEY=yes to confirm, or use UC_MODE=local / testnet.',
      );
    }
    return new OneClickAdapter({ ...base, dry: false });
  }

  if (mode === 'testnet') {
    if (env.TIDEPOOL_URL) {
      const tide: { baseUrl: string; fetch?: FetchLike } = { baseUrl: env.TIDEPOOL_URL };
      if (overrides.fetch) tide.fetch = overrides.fetch;
      return new TidepoolAdapter(tide);
    }
    const dry = new OneClickAdapter({ ...base, dry: true, timeoutMs: 8000 });
    return new MockAdapter({ priceSource: dryQuotePriceSource(dry), ...overrides.mock });
  }

  return new MockAdapter({ ...overrides.mock });
}
