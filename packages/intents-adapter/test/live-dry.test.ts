/**
 * Opt-in smoke test against the REAL 1Click API. Read-only: GET /v0/tokens and
 * `dry: true` quotes (no deposit address is created, no money can move).
 * Run with: UC_LIVE_DRY_TEST=1 pnpm --filter @uc/intents-adapter test
 */
import { describe, expect, it } from 'vitest';
import { MockAdapter, OneClickAdapter, USDC_NEAR_ASSET_ID, createAdapter } from '../src/index';
import { EVM_ADDR, USDT_POL } from './fixtures';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

describe.skipIf(env['UC_LIVE_DRY_TEST'] !== '1')('live 1Click (dry only)', () => {
  const adapter = new OneClickAdapter({ dry: true });

  it('lists tokens including USDC on NEAR and Polygon USDT', async () => {
    const tokens = await adapter.listTokens();
    expect(tokens.find((t) => t.assetId === USDC_NEAR_ASSET_ID)).toMatchObject({ symbol: 'USDC', chain: 'near', decimals: 6 });
    expect(tokens.find((t) => t.assetId === USDT_POL)).toMatchObject({ symbol: 'USDT', chain: 'pol', decimals: 6 });
  }, 30_000);

  it('dry pay + refund quotes parse', async () => {
    const pay = await adapter.quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: EVM_ADDR, recipientNear: 'example.near' });
    expect(pay).toMatchObject({ dry: true, depositAddress: '', amountOut: '1000000' });
    expect(BigInt(pay.amountIn) > 990_000n && BigInt(pay.amountIn) < 1_100_000n).toBe(true);
    const refund = await adapter.quoteRefund({ amountUsdc: '1000000', targetAsset: USDT_POL, targetAddress: EVM_ADDR, refundToNear: 'example.near' });
    expect(refund).toMatchObject({ dry: true, depositAddress: '', amountIn: '1000000' });
    expect(BigInt(refund.amountOut) > 900_000n && BigInt(refund.amountOut) < 1_010_000n).toBe(true);
  }, 30_000);

  it('testnet factory prices a mock quote from a real dry quote', async () => {
    const a = createAdapter({ UC_MODE: 'testnet' });
    expect(a).toBeInstanceOf(MockAdapter);
    const q = await a.quotePay({ originAsset: USDT_POL, amountUsd: '49000000', refundTo: EVM_ADDR, recipientNear: 'receipts.uc.testnet' });
    expect(q.raw).toMatchObject({ mock: true, pricing: 'source' });
    expect(q.amountOut).toBe('49000000');
  }, 30_000);
});
