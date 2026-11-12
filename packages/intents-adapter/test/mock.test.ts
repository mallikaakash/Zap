import { describe, expect, it, vi } from 'vitest';
import { MOCK_TOKENS, MockAdapter, USDC_NEAR_ASSET_ID, fakeDepositAddress, type DeliverEvent, type MockRecord, type MockStore, type RefundDeliveredEvent } from '../src/index';
import { EVM_ADDR, USDT_POL } from './fixtures';

const ETH = 'nep141:eth.omft.near';
const BTC = 'nep141:btc.omft.near';
const SOL = 'nep141:sol.omft.near';
const POL = 'nep141:pol.omdep.near';
const T0 = Date.parse('2026-11-11T17:00:00.000Z');

function clock(start = T0) {
  let t = start;
  return { now: () => t, advanceMins: (m: number) => (t += m * 60_000) };
}
const pay = (a: MockAdapter, over: Partial<Parameters<MockAdapter['quotePay']>[0]> = {}) =>
  a.quotePay({ originAsset: USDT_POL, amountUsd: '49000000', refundTo: EVM_ADDR, recipientNear: 'receipts.test.near', ...over });
const refund = (a: MockAdapter, over: Partial<Parameters<MockAdapter['quoteRefund']>[0]> = {}) =>
  a.quoteRefund({ amountUsdc: '49000000', targetAsset: USDT_POL, targetAddress: EVM_ADDR, refundToNear: 'receipts.test.near', ...over });

describe('MockAdapter tokens', () => {
  it('lists a fixed table with real-format asset ids and USDC on NEAR', async () => {
    const tokens = await new MockAdapter().listTokens();
    expect(tokens.length).toBeGreaterThanOrEqual(12);
    expect(new Set(tokens.map((t) => t.assetId)).size).toBe(tokens.length);
    for (const t of tokens) {
      expect(t.assetId).toMatch(/^nep141:/);
      expect(t.priceUsd).toMatch(/^[0-9]+(\.[0-9]+)?$/);
      expect(Number.isInteger(t.decimals)).toBe(true);
    }
    expect(tokens.find((t) => t.assetId === USDC_NEAR_ASSET_ID)).toMatchObject({ symbol: 'USDC', chain: 'near', decimals: 6 });
    const have = tokens.map((t) => `${t.symbol}@${t.chain}`);
    for (const want of ['USDT@pol', 'USDT@eth', 'USDT@tron', 'USDC@base', 'USDC@sol', 'USDC@arb', 'ETH@eth', 'BTC@btc', 'SOL@sol', 'wNEAR@near', 'POL@pol']) {
      expect(have).toContain(want);
    }
    tokens[0]!.priceUsd = '999'; // callers cannot mutate the table
    expect(MOCK_TOKENS[0]?.priceUsd).toBe('1');
  });
});

describe('MockAdapter quotes', () => {
  it('quotePay: exact USDC out, integer-math amountIn with a 0.3% fee', async () => {
    const a = new MockAdapter(clock());
    const q = await pay(a);
    expect(q).toMatchObject({ kind: 'pay', dry: false, originAsset: USDT_POL, destinationAsset: USDC_NEAR_ASSET_ID, amountOut: '49000000', minAmountOut: '49000000', amountIn: '49147000', deadline: '2026-11-11T17:30:00.000Z' });
    expect(q.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(q.id).toMatch(/^mock-[0-9a-f]{16}$/);
    expect(JSON.parse(JSON.stringify(q))).toEqual(q);
  });

  it('prices non-stable assets from the table and rounds amountIn up', async () => {
    const a = new MockAdapter(clock());
    // 49 / 2074.21 ETH -> ceil at 18 dp = 23623451820211069 wei, then x1.003 rounded up
    expect((await pay(a, { originAsset: ETH })).amountIn).toBe('23694322175671703');
    // 49 / 74144 BTC = 0.00066087... -> 66088 sats (ceil) -> *1.003 = 66286.264 -> 66287
    expect((await pay(a, { originAsset: BTC })).amountIn).toBe('66287');
    const sol = await pay(a, { originAsset: SOL });
    expect(sol.depositAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{44}$/);
    expect((await pay(a, { originAsset: BTC })).depositAddress).toMatch(/^bc1q[a-z0-9]{38}$/);
    expect((await pay(a, { originAsset: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near' })).depositAddress).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });

  it('the payer never underpays: amountIn is always worth >= amountOut', async () => {
    const a = new MockAdapter({ feeBps: 0 });
    for (const asset of [ETH, BTC, SOL, POL, USDT_POL]) {
      for (const amountUsd of ['1', '7', '999999', '49000000', '123456789012']) {
        const q = await pay(a, { originAsset: asset, amountUsd });
        const t = MOCK_TOKENS.find((x) => x.assetId === asset)!;
        const priceE8 = BigInt(Math.round(Number(t.priceUsd) * 1e8));
        // value(amountIn) in USDC minor units * 1e8, compared without division
        expect(BigInt(q.amountIn) * priceE8 * 10n ** 6n >= BigInt(amountUsd) * 10n ** 8n * 10n ** BigInt(t.decimals)).toBe(true);
      }
    }
  });

  it('quoteRefund: exact USDC in, amountOut rounded down after the fee, NEAR deposit address', async () => {
    const a = new MockAdapter(clock());
    const q = await refund(a);
    expect(q).toMatchObject({ kind: 'refund', originAsset: USDC_NEAR_ASSET_ID, destinationAsset: USDT_POL, amountIn: '49000000', amountOut: '48853000' });
    expect(q.depositAddress).toMatch(/^[0-9a-f]{64}$/);
    // 49 / 84.63 SOL = 0.578990901571546...; floor at 9dp = 578990901; *0.997 floor = 577253928
    expect((await refund(a, { targetAsset: SOL })).amountOut).toBe('577253928');
  });

  it('is deterministic for the same seed, clock and inputs; addresses differ per quote', async () => {
    const a = new MockAdapter({ ...clock(), seed: 's' });
    const b = new MockAdapter({ ...clock(), seed: 's' });
    const [qa1, qb1] = [await pay(a), await pay(b)];
    expect(qa1).toEqual(qb1);
    const qa2 = await pay(a);
    expect(qa2.depositAddress).not.toBe(qa1.depositAddress);
    expect((await pay(new MockAdapter({ ...clock(), seed: 'other' }))).depositAddress).not.toBe(qa1.depositAddress);
    expect(fakeDepositAddress('pol', 'x')).toBe(fakeDepositAddress('pol', 'x'));
  });

  it('validates inputs', async () => {
    const a = new MockAdapter();
    await expect(pay(a, { amountUsd: '49.5' })).rejects.toThrow(/amountUsd/);
    await expect(pay(a, { amountUsd: '0' })).rejects.toThrow(/greater than zero/);
    await expect(pay(a, { originAsset: 'nep141:nope' })).rejects.toThrow(/unknown asset/);
    await expect(pay(a, { recipientNear: '' })).rejects.toThrow(/recipientNear/);
    await expect(refund(a, { amountUsdc: 'abc' })).rejects.toThrow(/amountUsdc/);
    await expect(refund(a, { targetAsset: BTC, amountUsdc: '1' })).rejects.toThrow(/too small/);
    expect(() => new MockAdapter({ feeBps: 1.5 })).toThrow(/feeBps/);
  });
});

describe('MockAdapter priceSource', () => {
  it('uses the source amounts when it answers', async () => {
    const priceSource = vi.fn(async () => ({ amountIn: '49550824', amountOut: '49000000', minAmountIn: '49055363' }));
    const a = new MockAdapter({ priceSource });
    const q = await pay(a);
    expect(priceSource).toHaveBeenCalledWith({ kind: 'pay', originAsset: USDT_POL, destinationAsset: USDC_NEAR_ASSET_ID, amount: '49000000', refundTo: EVM_ADDR, recipient: 'receipts.test.near' });
    expect(q).toMatchObject({ amountIn: '49550824', minAmountIn: '49055363', amountOut: '49000000' });
    expect(q.raw).toMatchObject({ mock: true, pricing: 'source' });
    expect(q.depositAddress).toMatch(/^0x[0-9a-f]{40}$/); // still a fake address
  });

  it('refund quotes use the source amountOut', async () => {
    const a = new MockAdapter({ priceSource: async () => ({ amountIn: '49000000', amountOut: '48500000', minAmountOut: '48000000' }) });
    expect(await refund(a)).toMatchObject({ amountIn: '49000000', amountOut: '48500000', minAmountOut: '48000000' });
  });

  it('falls back to the table when the source throws, returns nothing, garbage, or the wrong amount', async () => {
    const sources = [
      async () => { throw new Error('offline'); },
      async () => null,
      async () => ({ amountIn: '49.5', amountOut: '49000000' }),
      async () => ({ amountIn: '0', amountOut: '49000000' }),
      async () => ({ amountIn: '50000000', amountOut: '48000000' }), // would short the merchant
    ];
    for (const priceSource of sources) {
      const q = await pay(new MockAdapter({ priceSource }));
      expect(q.amountIn).toBe('49147000');
      expect(q.amountOut).toBe('49000000');
      expect(q.raw).toMatchObject({ pricing: 'table' });
    }
  });

  it('falls back to the table when the source hangs', async () => {
    const a = new MockAdapter({ priceSource: () => new Promise(() => {}), priceSourceTimeoutMs: 20 });
    expect((await pay(a)).raw).toMatchObject({ pricing: 'table' });
  });
});

describe('MockAdapter status + simulation', () => {
  it('simulatePayment: PENDING_DEPOSIT -> PROCESSING -> SUCCESS and delivers once', async () => {
    const delivered: DeliverEvent[] = [];
    let seenDuring: string | undefined;
    const a: MockAdapter = new MockAdapter({
      onDeliver: async (e) => {
        seenDuring = await a.status(e.quote.depositAddress);
        delivered.push(e);
      },
    });
    const q = await pay(a);
    expect(await a.status(q.depositAddress)).toBe('PENDING_DEPOSIT');
    expect(await a.simulatePayment(q.depositAddress)).toBe('SUCCESS');
    expect(seenDuring).toBe('PROCESSING');
    expect(await a.status(q.depositAddress)).toBe('SUCCESS');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ recipientNear: 'receipts.test.near', amountOut: '49000000' });
    expect(delivered[0]?.quote).toEqual(q);

    expect(await a.simulatePayment(q.depositAddress)).toBe('SUCCESS'); // idempotent
    expect(delivered).toHaveLength(1);
  });

  it('concurrent simulatePayment calls deliver only once', async () => {
    const onDeliver = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const a = new MockAdapter({ onDeliver });
    const q = await pay(a);
    const results = await Promise.all([a.simulatePayment(q.depositAddress), a.simulatePayment(q.depositAddress)]);
    expect(onDeliver).toHaveBeenCalledTimes(1);
    expect(results.sort()).toEqual(['PROCESSING', 'SUCCESS']);
  });

  it('a failing onDeliver rolls back so the payment can be retried', async () => {
    let fail = true;
    const onDeliver = vi.fn(async () => { if (fail) throw new Error('mint failed'); });
    const a = new MockAdapter({ onDeliver });
    const q = await pay(a);
    await expect(a.simulatePayment(q.depositAddress)).rejects.toThrow('mint failed');
    expect(await a.status(q.depositAddress)).toBe('PENDING_DEPOSIT');
    fail = false;
    expect(await a.simulatePayment(q.depositAddress)).toBe('SUCCESS');
    expect(onDeliver).toHaveBeenCalledTimes(2);
  });

  it('simulateRefundDelivery marks a refund quote SUCCESS and reports the fake refund', async () => {
    const events: RefundDeliveredEvent[] = [];
    const a = new MockAdapter({ onRefundDelivered: async (e) => void events.push(e) });
    const q = await refund(a);
    await a.submitDeposit(q.depositAddress, 'near-tx-hash', { nearSenderAccount: 'receipts.test.near' });
    expect(await a.status(q.depositAddress)).toBe('KNOWN_DEPOSIT_TX');
    expect((await a.getRecord(q.depositAddress))?.depositTxHash).toBe('near-tx-hash');
    expect(await a.simulateRefundDelivery(q.depositAddress)).toBe('SUCCESS');
    expect(events).toEqual([{ quote: q, targetAsset: USDT_POL, targetAddress: EVM_ADDR, amountOut: '48853000' }]);
    expect(await a.simulateRefundDelivery(q.depositAddress)).toBe('SUCCESS');
    expect(events).toHaveLength(1);
  });

  it('refuses to settle a quote with the wrong helper, and unknown addresses', async () => {
    const a = new MockAdapter();
    const p = await pay(a);
    const r = await refund(a);
    await expect(a.simulateRefundDelivery(p.depositAddress)).rejects.toThrow(/pay quote/);
    await expect(a.simulatePayment(r.depositAddress)).rejects.toThrow(/refund quote/);
    await expect(a.status('0xnope')).rejects.toThrow(/not found/);
    await expect(a.simulatePayment('0xnope')).rejects.toThrow(/not found/);
  });

  it('expired unpaid quotes are FAILED; paying after the deadline is REFUNDED with no delivery', async () => {
    const c = clock();
    const onDeliver = vi.fn(async () => {});
    const a = new MockAdapter({ now: c.now, onDeliver });
    const q1 = await pay(a, { deadlineMins: 10 });
    const q2 = await pay(a, { deadlineMins: 10 });
    const q3 = await pay(a, { deadlineMins: 60 });
    c.advanceMins(11);
    expect(await a.status(q1.depositAddress)).toBe('FAILED');
    expect(await a.simulatePayment(q2.depositAddress)).toBe('REFUNDED');
    expect(await a.status(q2.depositAddress)).toBe('REFUNDED');
    expect(onDeliver).not.toHaveBeenCalled();
    expect(await a.simulatePayment(q3.depositAddress)).toBe('SUCCESS');
    c.advanceMins(600);
    expect(await a.status(q3.depositAddress)).toBe('SUCCESS'); // terminal states do not expire
  });
});

describe('MockAdapter state', () => {
  it('exportState/importState round-trips through JSON into another instance', async () => {
    const web = new MockAdapter({ seed: 'shared' });
    const paid = await pay(web);
    const open = await pay(web, { originAsset: ETH });
    await web.simulatePayment(paid.depositAddress);
    const json = JSON.stringify(web.exportState());

    const onDeliver = vi.fn(async () => {});
    const worker = new MockAdapter({ seed: 'shared', onDeliver });
    worker.importState(json);
    expect(await worker.status(paid.depositAddress)).toBe('SUCCESS');
    expect(await worker.status(open.depositAddress)).toBe('PENDING_DEPOSIT');
    expect(await worker.simulatePayment(open.depositAddress)).toBe('SUCCESS');
    expect(onDeliver).toHaveBeenCalledTimes(1);
    expect((await worker.getRecord(open.depositAddress))?.quote).toEqual(open);

    // the counter continues, so new quotes never reuse an address
    const next = await pay(worker);
    expect([paid.depositAddress, open.depositAddress]).not.toContain(next.depositAddress);
    expect(worker.exportState().counter).toBe(3);
    expect(() => worker.importState('{"nope":1}')).toThrow(/importState/);
  });

  it('exported state is a detached copy', async () => {
    const a = new MockAdapter();
    const q = await pay(a);
    const state = a.exportState();
    state.records[q.depositAddress]!.status = 'SUCCESS';
    expect(await a.status(q.depositAddress)).toBe('PENDING_DEPOSIT');
  });

  it('a shared MockStore lets two adapters (web + worker) see the same swaps', async () => {
    const db = new Map<string, string>();
    const store: MockStore = {
      get: async (addr) => (db.has(addr) ? (JSON.parse(db.get(addr)!) as MockRecord) : undefined),
      put: async (rec) => void db.set(rec.quote.depositAddress, JSON.stringify(rec)),
    };
    const onDeliver = vi.fn(async () => {});
    const web = new MockAdapter({ store });
    const worker = new MockAdapter({ store, onDeliver });
    const q = await pay(web);
    expect(await worker.status(q.depositAddress)).toBe('PENDING_DEPOSIT');
    expect(await worker.simulatePayment(q.depositAddress)).toBe('SUCCESS');
    expect(await web.status(q.depositAddress)).toBe('SUCCESS');
    expect(await web.simulatePayment(q.depositAddress)).toBe('SUCCESS');
    expect(onDeliver).toHaveBeenCalledTimes(1);
    expect(() => web.exportState()).toThrow(/custom MockStore/);
  });
});
