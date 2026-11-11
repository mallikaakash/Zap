import { describe, expect, it } from 'vitest';
import { OneClickAdapter, OneClickError, TidepoolAdapter, USDC_NEAR_ASSET_ID } from '../src/index';
import {
  BAD_REQUEST_RESPONSE,
  DRY_PAY_RESPONSE,
  DRY_REFUND_RESPONSE,
  EVM_ADDR,
  FAKE_DEPOSIT,
  LIVE_QUOTE_RESPONSE,
  STATUS_RESPONSE,
  TOKENS_RESPONSE,
  USDT_POL,
  mockFetch,
} from './fixtures';

const NOW = Date.parse('2026-11-11T17:00:00.000Z');
const now = () => NOW;

describe('OneClickAdapter', () => {
  it('lists tokens and maps blockchain/price to chain/priceUsd', async () => {
    const { fetch, calls } = mockFetch({ 'GET /v0/tokens': { body: TOKENS_RESPONSE } });
    const tokens = await new OneClickAdapter({ fetch }).listTokens();
    expect(calls[0]?.url).toBe('https://1click.chaindefuser.com/v0/tokens');
    expect(tokens).toHaveLength(4);
    expect(tokens[1]).toEqual({
      assetId: USDC_NEAR_ASSET_ID,
      symbol: 'USDC',
      chain: 'near',
      decimals: 6,
      priceUsd: '0.99965',
      contractAddress: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      priceUpdatedAt: '2026-11-11T16:57:30.947Z',
    });
    expect(tokens[3]?.contractAddress).toBeUndefined();
    expect(tokens[3]?.priceUsd).toBe('74144');
  });

  it('quotePay sends an EXACT_OUTPUT request with every required 1Click field', async () => {
    const { fetch, calls } = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_PAY_RESPONSE } });
    const adapter = new OneClickAdapter({ fetch, dry: true, now });
    const q = await adapter.quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: EVM_ADDR, recipientNear: 'example.near' });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({
      dry: true,
      swapType: 'EXACT_OUTPUT',
      slippageTolerance: 100,
      originAsset: USDT_POL,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: USDC_NEAR_ASSET_ID,
      amount: '1000000',
      refundTo: EVM_ADDR,
      refundType: 'ORIGIN_CHAIN',
      recipient: 'example.near',
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-11-11T17:30:00.000Z',
      quoteWaitingTimeMs: 3000,
    });
    expect(calls[0]?.headers['authorization']).toBeUndefined();

    expect(q).toMatchObject({
      id: '23108556-50d7-4af6-b5ff-12db9d45fe26',
      kind: 'pay',
      dry: true,
      depositAddress: '',
      amountIn: '1015793',
      minAmountIn: '1005682',
      amountOut: '1000000',
      minAmountOut: '1000000',
      deadline: '2026-11-11T17:30:00.000Z', // dry quotes have no deadline: ours is echoed
      timeEstimateSecs: 35,
    });
    expect(q.raw).toEqual(DRY_PAY_RESPONSE);
  });

  it('dry: true is forced on every quote; non-dry returns the deposit address and 1Click deadline', async () => {
    const dryRun = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_REFUND_RESPONSE } });
    await new OneClickAdapter({ fetch: dryRun.fetch, dry: true }).quoteRefund({ amountUsdc: '1000000', targetAsset: USDT_POL, targetAddress: EVM_ADDR, refundToNear: 'example.near' });
    expect(dryRun.calls[0]?.body.dry).toBe(true);

    const live = mockFetch({ 'POST /v0/quote': { status: 201, body: LIVE_QUOTE_RESPONSE } });
    const q = await new OneClickAdapter({ fetch: live.fetch, now }).quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: EVM_ADDR, recipientNear: 'example.near', deadlineMins: 10 });
    expect(live.calls[0]?.body.dry).toBe(false);
    expect(live.calls[0]?.body.deadline).toBe('2026-11-11T17:10:00.000Z');
    expect(q.dry).toBe(false);
    expect(q.depositAddress).toBe(FAKE_DEPOSIT);
    expect(q.deadline).toBe('2026-11-11T17:28:41.000Z');
  });

  it('quoteRefund sends EXACT_INPUT from USDC on NEAR to the target chain', async () => {
    const { fetch, calls } = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_REFUND_RESPONSE } });
    const q = await new OneClickAdapter({ fetch, dry: true, now }).quoteRefund({ amountUsdc: '1000000', targetAsset: USDT_POL, targetAddress: EVM_ADDR, refundToNear: 'merchant.near' });
    expect(calls[0]?.body).toMatchObject({
      swapType: 'EXACT_INPUT',
      originAsset: USDC_NEAR_ASSET_ID,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: USDT_POL,
      amount: '1000000',
      refundTo: 'merchant.near',
      refundType: 'ORIGIN_CHAIN',
      recipient: EVM_ADDR,
      recipientType: 'DESTINATION_CHAIN',
    });
    expect(q).toMatchObject({ kind: 'refund', amountIn: '1000000', amountOut: '990317', minAmountOut: '980413' });
  });

  it('sends auth headers, custom USDC asset id and slippage', async () => {
    const { fetch, calls } = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_REFUND_RESPONSE } });
    const adapter = new OneClickAdapter({ fetch, dry: true, jwt: 'jwt-token', apiKey: 'key', usdcNearAssetId: 'nep141:other-usdc.near', slippageBps: 50, referral: 'uc' });
    await adapter.quoteRefund({ amountUsdc: '1000000', targetAsset: USDT_POL, targetAddress: EVM_ADDR, refundToNear: 'm.near' });
    expect(calls[0]?.headers['authorization']).toBe('Bearer jwt-token');
    expect(calls[0]?.headers['x-api-key']).toBe('key');
    expect(calls[0]?.body).toMatchObject({ originAsset: 'nep141:other-usdc.near', slippageTolerance: 50, referral: 'uc' });
  });

  it('rejects float / non-integer amounts before any network call', async () => {
    const { fetch, calls } = mockFetch({});
    const adapter = new OneClickAdapter({ fetch, dry: true });
    for (const bad of ['49.00', '0', '-1', '1e6', '', '049']) {
      await expect(adapter.quotePay({ originAsset: USDT_POL, amountUsd: bad, refundTo: EVM_ADDR, recipientNear: 'a.near' })).rejects.toThrow(/amountUsd/);
    }
    await expect(adapter.quoteRefund({ amountUsdc: 49 as unknown as string, targetAsset: USDT_POL, targetAddress: EVM_ADDR, refundToNear: 'a.near' })).rejects.toThrow(/amountUsdc/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a pay quote whose amountOut is not the exact amount requested', async () => {
    const { fetch } = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_PAY_RESPONSE } });
    const adapter = new OneClickAdapter({ fetch, dry: true });
    await expect(adapter.quotePay({ originAsset: USDT_POL, amountUsd: '2000000', refundTo: EVM_ADDR, recipientNear: 'a.near' })).rejects.toThrow(/expected 2000000/);
  });

  it('refuses a non-dry quote response without a deposit address', async () => {
    const { fetch } = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_PAY_RESPONSE } });
    await expect(new OneClickAdapter({ fetch }).quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: EVM_ADDR, recipientNear: 'a.near' })).rejects.toThrow(/depositAddress/);
  });

  it('turns 1Click error bodies into OneClickError', async () => {
    const { fetch } = mockFetch({ 'POST /v0/quote': { status: 400, body: BAD_REQUEST_RESPONSE } });
    const err = await new OneClickAdapter({ fetch, dry: true })
      .quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: 'bad', recipientNear: 'a.near' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OneClickError);
    expect((err as OneClickError).httpStatus).toBe(400);
    expect((err as OneClickError).message).toContain('refundTo is not valid');
  });

  it('status queries depositAddress (+ depositMemo) and returns the status string', async () => {
    const { fetch, calls } = mockFetch({ 'GET /v0/status': { body: STATUS_RESPONSE } });
    const adapter = new OneClickAdapter({ fetch, jwt: 'j' });
    expect(await adapter.status(FAKE_DEPOSIT)).toBe('SUCCESS');
    expect(calls[0]?.url).toBe(`https://1click.chaindefuser.com/v0/status?depositAddress=${FAKE_DEPOSIT}`);
    await adapter.status('GABC', '123456');
    expect(calls[1]?.url).toBe('https://1click.chaindefuser.com/v0/status?depositAddress=GABC&depositMemo=123456');
    const details = await adapter.statusDetails(FAKE_DEPOSIT);
    expect(details.swapDetails.destinationChainTxHashes[0]?.explorerUrl).toContain('nearblocks');
  });

  it('status surfaces a 404 for an unknown deposit address', async () => {
    const { fetch } = mockFetch({ 'GET /v0/status': { status: 404, body: { message: 'Deposit address 0xabc not found', error: 'Not Found', statusCode: 404 } } });
    await expect(new OneClickAdapter({ fetch }).status('0xabc')).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('submitDeposit posts txHash, depositAddress and the optional NEAR sender / memo', async () => {
    const { fetch, calls } = mockFetch({ 'POST /v0/deposit/submit': { body: STATUS_RESPONSE } });
    const adapter = new OneClickAdapter({ fetch });
    await adapter.submitDeposit(FAKE_DEPOSIT, '0xhash');
    expect(calls[0]?.body).toEqual({ txHash: '0xhash', depositAddress: FAKE_DEPOSIT });
    await adapter.submitDeposit('abc', 'nearhash', { nearSenderAccount: 'receipts.near', memo: '7' });
    expect(calls[1]?.body).toEqual({ txHash: 'nearhash', depositAddress: 'abc', nearSenderAccount: 'receipts.near', memo: '7' });
  });
});

describe('TidepoolAdapter', () => {
  it('uses the configured base URL with the same API shape', async () => {
    const { fetch, calls } = mockFetch({ 'GET /v0/tokens': { body: TOKENS_RESPONSE } });
    const adapter = new TidepoolAdapter({ baseUrl: 'http://localhost:8787/', fetch });
    expect(adapter.experimental).toBe(true);
    await adapter.listTokens();
    expect(calls[0]?.url).toBe('http://localhost:8787/v0/tokens');
  });

  it('requires a base URL', () => {
    expect(() => new TidepoolAdapter({ baseUrl: '' })).toThrow(/baseUrl/);
  });
});
