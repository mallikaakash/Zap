import { describe, expect, it } from 'vitest';
import { MockAdapter, OneClickAdapter, TidepoolAdapter, createAdapter, dryQuotePriceSource, isMockAdapter, parseMode } from '../src/index';
import { DRY_PAY_RESPONSE, DRY_REFUND_RESPONSE, EVM_ADDR, USDT_POL, mockFetch } from './fixtures';

describe('createAdapter', () => {
  it('defaults to local: a MockAdapter that never touches the network', async () => {
    const { fetch, calls } = mockFetch({});
    for (const env of [{}, { UC_MODE: '' }, { UC_MODE: 'local' }, { UC_MODE: 'local', TIDEPOOL_URL: 'http://x', CONFIRM_REAL_MONEY: 'yes' }]) {
      const a = createAdapter(env, { fetch });
      expect(a).toBeInstanceOf(MockAdapter);
      expect(isMockAdapter(a)).toBe(true);
      const q = await a.quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: EVM_ADDR, recipientNear: 'r.near' });
      expect(q.raw).toMatchObject({ pricing: 'table' });
    }
    expect(calls).toHaveLength(0);
  });

  it('reads process.env when called with no arguments', () => {
    expect(createAdapter()).toBeInstanceOf(MockAdapter);
  });

  it('rejects unknown modes', () => {
    expect(() => createAdapter({ UC_MODE: 'mainnet' })).toThrow(/UC_MODE/);
    expect(parseMode(undefined)).toBe('local');
  });

  it('live throws unless CONFIRM_REAL_MONEY is exactly "yes"', () => {
    for (const confirm of [undefined, '', 'true', 'YES', '1']) {
      const env = confirm === undefined ? { UC_MODE: 'live' } : { UC_MODE: 'live', CONFIRM_REAL_MONEY: confirm };
      expect(() => createAdapter(env)).toThrow(/CONFIRM_REAL_MONEY=yes/);
    }
  });

  it('live + CONFIRM_REAL_MONEY=yes returns a real, non-dry OneClickAdapter with JWT and base URL', async () => {
    const { fetch, calls } = mockFetch({ 'GET /v0/tokens': { body: [] } });
    const a = createAdapter({ UC_MODE: 'live', CONFIRM_REAL_MONEY: 'yes', ONECLICK_JWT: 'tok', ONECLICK_BASE_URL: 'https://proxy.example/' }, { fetch });
    expect(a).toBeInstanceOf(OneClickAdapter);
    expect(a).not.toBeInstanceOf(TidepoolAdapter);
    expect((a as OneClickAdapter).dry).toBe(false);
    await a.listTokens();
    expect(calls[0]?.url).toBe('https://proxy.example/v0/tokens');
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok');
  });

  it('testnet: MockAdapter priced by DRY 1Click quotes, with a mainnet placeholder for the NEAR account', async () => {
    const { fetch, calls } = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_PAY_RESPONSE } });
    const a = createAdapter({ UC_MODE: 'testnet' }, { fetch });
    expect(a).toBeInstanceOf(MockAdapter);
    const q = await a.quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: EVM_ADDR, recipientNear: 'receipts.uc.testnet' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({ dry: true, swapType: 'EXACT_OUTPUT', recipient: 'example.near', refundTo: EVM_ADDR });
    expect(q).toMatchObject({ amountIn: '1015793', minAmountIn: '1005682', amountOut: '1000000' });
    expect(q.raw).toMatchObject({ mock: true, pricing: 'source', recipient: 'receipts.uc.testnet' });
    expect(q.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('testnet refund quotes are dry-priced too', async () => {
    const { fetch, calls } = mockFetch({ 'POST /v0/quote': { status: 201, body: DRY_REFUND_RESPONSE } });
    const a = createAdapter({ UC_MODE: 'testnet' }, { fetch });
    const q = await a.quoteRefund({ amountUsdc: '1000000', targetAsset: USDT_POL, targetAddress: EVM_ADDR, refundToNear: 'receipts.uc.testnet' });
    expect(calls[0]?.body).toMatchObject({ dry: true, swapType: 'EXACT_INPUT', refundTo: 'example.near', recipient: EVM_ADDR });
    expect(q).toMatchObject({ amountIn: '1000000', amountOut: '990317', minAmountOut: '980413' });
  });

  it('testnet falls back to the price table when 1Click is unreachable or rejects', async () => {
    const down = mockFetch({ 'POST /v0/quote': () => { throw new TypeError('fetch failed'); } });
    const rejected = mockFetch({ 'POST /v0/quote': { status: 400, body: { message: 'refundTo is not valid' } } });
    for (const { fetch } of [down, rejected]) {
      const q = await createAdapter({ UC_MODE: 'testnet' }, { fetch }).quotePay({ originAsset: USDT_POL, amountUsd: '1000000', refundTo: 'x', recipientNear: 'r.testnet' });
      expect(q).toMatchObject({ amountIn: '1003000', amountOut: '1000000' });
      expect(q.raw).toMatchObject({ pricing: 'table' });
    }
  });

  it('testnet + TIDEPOOL_URL returns the experimental TidepoolAdapter', () => {
    const a = createAdapter({ UC_MODE: 'testnet', TIDEPOOL_URL: 'http://localhost:8787' });
    expect(a).toBeInstanceOf(TidepoolAdapter);
    expect((a as TidepoolAdapter).baseUrl).toBe('http://localhost:8787');
  });

  it('passes mock options through (onDeliver etc.)', async () => {
    let delivered = '';
    const a = createAdapter({}, { mock: { onDeliver: async (e) => void (delivered = e.amountOut) } }) as MockAdapter;
    const q = await a.quotePay({ originAsset: USDT_POL, amountUsd: '5000000', refundTo: EVM_ADDR, recipientNear: 'r.near' });
    await a.simulatePayment(q.depositAddress);
    expect(delivered).toBe('5000000');
  });

  it('dryQuotePriceSource refuses a non-dry adapter', () => {
    expect(() => dryQuotePriceSource(new OneClickAdapter({ dry: false }))).toThrow(/dry: true/);
  });
});
