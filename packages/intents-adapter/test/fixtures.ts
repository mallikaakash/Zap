/**
 * Fixtures shaped like the real 1Click API.
 * TOKENS_RESPONSE / DRY_PAY_RESPONSE / DRY_REFUND_RESPONSE are verbatim live
 * responses captured 2026-11-11 (tokens trimmed to 4 rows). LIVE_QUOTE_RESPONSE
 * and STATUS_RESPONSE are built from the OpenAPI schema (a non-dry quote was
 * never requested), with obviously fake addresses and hashes.
 */
export const USDC_NEAR = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const USDT_POL = 'nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near';
export const EVM_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

export const TOKENS_RESPONSE = [
  { assetId: 'nep141:wrap.near', decimals: 24, blockchain: 'near', symbol: 'wNEAR', price: 3.77, priceUpdatedAt: '2026-11-11T16:57:30.947Z', contractAddress: 'wrap.near', coingeckoId: 'wrapped-near' },
  { assetId: USDC_NEAR, decimals: 6, blockchain: 'near', symbol: 'USDC', price: 0.99965, priceUpdatedAt: '2026-11-11T16:57:30.947Z', contractAddress: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', coingeckoId: 'usd-coin' },
  { assetId: USDT_POL, decimals: 6, blockchain: 'pol', symbol: 'USDT', price: 0.999264, priceUpdatedAt: '2026-11-11T16:57:30.947Z', contractAddress: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', coingeckoId: 'tether' },
  { assetId: 'nep141:btc.omft.near', decimals: 8, blockchain: 'btc', symbol: 'BTC', price: 74144, priceUpdatedAt: '2026-11-11T16:57:30.947Z' },
];

export const DRY_PAY_RESPONSE = {
  quote: { amountIn: '1015793', amountInFormatted: '1.015793', amountInUsd: '1.015045376352', minAmountIn: '1005682', amountOut: '1000000', amountOutFormatted: '1.0', amountOutUsd: '0.999650000000', minAmountOut: '1000000', timeEstimate: 35, refundFee: '10034', withdrawFee: '4715' },
  quoteRequest: { dry: true, depositMode: 'SIMPLE', swapType: 'EXACT_OUTPUT', slippageTolerance: 100, originAsset: USDT_POL, depositType: 'ORIGIN_CHAIN', destinationAsset: USDC_NEAR, amount: '1000000', refundTo: EVM_ADDR, refundType: 'ORIGIN_CHAIN', recipient: 'example.near', recipientType: 'DESTINATION_CHAIN', deadline: '2026-11-12T20:00:00.000Z', confidentiality: 'public', quoteWaitingTimeMs: 3000, insured: false, appFees: [{ recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd', fee: 1 }] },
  signature: 'ed25519:5p68ztk9MxL1VdXkTSNeznxL49T2ywmsEja7z8Qvpq12wgHfXYvQPY22q4kyau8Akgwt3NDrrVXy8kBEFkRYXGj',
  timestamp: '2026-11-11T16:58:41.804Z',
  correlationId: '23108556-50d7-4af6-b5ff-12db9d45fe26',
};

export const DRY_REFUND_RESPONSE = {
  quote: { amountIn: '1000000', amountInFormatted: '1.0', amountInUsd: '0.999650000000', minAmountIn: '1000000', amountOut: '990317', amountOutFormatted: '0.990317', amountOutUsd: '0.989588126688', minAmountOut: '980413', timeEstimate: 26, refundFee: '4715', withdrawFee: '10008' },
  quoteRequest: { dry: true, depositMode: 'SIMPLE', swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: USDC_NEAR, depositType: 'ORIGIN_CHAIN', destinationAsset: USDT_POL, amount: '1000000', refundTo: 'example.near', refundType: 'ORIGIN_CHAIN', recipient: EVM_ADDR, recipientType: 'DESTINATION_CHAIN', deadline: '2026-11-12T20:00:00.000Z', confidentiality: 'public', quoteWaitingTimeMs: 3000, insured: false, appFees: [{ recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd', fee: 1 }] },
  signature: 'ed25519:4tQ2gC1YZsziQp4x1JW545samFzpbnMW57dxxWgoWk2BAKNdh4s3d3RFg1eELqP5Jjx2vtMoYuKJW9tEFpWFt5fk',
  timestamp: '2026-11-11T16:58:45.685Z',
  correlationId: 'fa66c587-68e4-420d-b716-29f8060444f4',
};

export const FAKE_DEPOSIT = '0x1111111111111111111111111111111111111111';

export const LIVE_QUOTE_RESPONSE = {
  ...DRY_PAY_RESPONSE,
  correlationId: 'aaaaaaaa-0000-4000-8000-000000000001',
  quoteRequest: { ...DRY_PAY_RESPONSE.quoteRequest, dry: false },
  quote: { ...DRY_PAY_RESPONSE.quote, depositAddress: FAKE_DEPOSIT, deadline: '2026-11-11T17:28:41.000Z', timeWhenInactive: '2026-11-11T17:28:41.000Z' },
};

export const STATUS_RESPONSE = {
  correlationId: 'aaaaaaaa-0000-4000-8000-000000000002',
  quoteResponse: LIVE_QUOTE_RESPONSE,
  status: 'SUCCESS',
  updatedAt: '2026-11-11T17:05:00.000Z',
  swapDetails: {
    intentHashes: ['fakeIntentHash'],
    nearTxHashes: ['fakeNearTxHash'],
    amountIn: '1005700',
    amountOut: '1000000',
    originChainTxHashes: [{ hash: '0xfakeorigin', explorerUrl: 'https://polygonscan.com/tx/0xfakeorigin' }],
    destinationChainTxHashes: [{ hash: 'fakeNearTxHash', explorerUrl: 'https://nearblocks.io/txns/fakeNearTxHash' }],
  },
};

export const BAD_REQUEST_RESPONSE = { message: 'refundTo is not valid', correlationId: 'e0a1b255-f2b6-4588-8c7e-37921b494b20', timestamp: '2026-11-11T16:58:30.116Z', path: '/v0/quote' };

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** fetch stub: routes by "METHOD /path" and records every call. */
export function mockFetch(routes: Record<string, { status?: number; body: unknown } | (() => never)>) {
  const calls: Call[] = [];
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    calls.push({ url: input, method, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return new Response(JSON.stringify({ message: 'no route' }), { status: 500 });
    if (typeof route === 'function') return route();
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}
