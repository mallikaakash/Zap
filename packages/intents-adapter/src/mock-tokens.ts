import { USDC_NEAR_ASSET_ID, type Token } from './types';

/**
 * Fixed token table for MockAdapter. Asset ids, chains and decimals are copied
 * from the live 1Click `GET /v0/tokens` response (2026-11-11); prices are a
 * frozen snapshot of the same response, with stablecoins pinned to exactly $1.
 */
export const MOCK_TOKENS: readonly Token[] = [
  { assetId: USDC_NEAR_ASSET_ID, symbol: 'USDC', chain: 'near', decimals: 6, priceUsd: '1', contractAddress: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' },
  { assetId: 'nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near', symbol: 'USDT', chain: 'pol', decimals: 6, priceUsd: '1', contractAddress: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f' },
  { assetId: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', symbol: 'USDT', chain: 'eth', decimals: 6, priceUsd: '1', contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
  { assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', symbol: 'USDT', chain: 'tron', decimals: 6, priceUsd: '1', contractAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
  { assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', symbol: 'USDC', chain: 'base', decimals: 6, priceUsd: '1', contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', symbol: 'USDC', chain: 'sol', decimals: 6, priceUsd: '1', contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
  { assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', symbol: 'USDC', chain: 'arb', decimals: 6, priceUsd: '1', contractAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
  { assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', symbol: 'USDC', chain: 'eth', decimals: 6, priceUsd: '1', contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  { assetId: 'nep141:eth.omft.near', symbol: 'ETH', chain: 'eth', decimals: 18, priceUsd: '2074.21' },
  { assetId: 'nep141:base.omft.near', symbol: 'ETH', chain: 'base', decimals: 18, priceUsd: '2074.21' },
  { assetId: 'nep141:btc.omft.near', symbol: 'BTC', chain: 'btc', decimals: 8, priceUsd: '74144' },
  { assetId: 'nep141:sol.omft.near', symbol: 'SOL', chain: 'sol', decimals: 9, priceUsd: '84.63' },
  { assetId: 'nep141:wrap.near', symbol: 'wNEAR', chain: 'near', decimals: 24, priceUsd: '3.77', contractAddress: 'wrap.near' },
  { assetId: 'nep141:pol.omdep.near', symbol: 'POL', chain: 'pol', decimals: 18, priceUsd: '0.089361' },
];
