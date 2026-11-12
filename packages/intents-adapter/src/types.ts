/**
 * Shared types for the intents adapters (SPEC §5).
 *
 * MONEY RULE: every amount is an integer in the asset's smallest unit, encoded
 * as a decimal string ("49000000" = 49 USDC, 6 dp). Never floats.
 */

/** Statuses returned by 1Click `GET /v0/status` (verified against the OpenAPI enum). */
export type SwapStatus =
  | 'PENDING_DEPOSIT'
  | 'KNOWN_DEPOSIT_TX'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED';

export const SWAP_STATUSES: readonly SwapStatus[] = [
  'PENDING_DEPOSIT',
  'KNOWN_DEPOSIT_TX',
  'INCOMPLETE_DEPOSIT',
  'PROCESSING',
  'SUCCESS',
  'REFUNDED',
  'FAILED',
];

/** Statuses after which polling can stop. */
export const TERMINAL_STATUSES: readonly SwapStatus[] = ['SUCCESS', 'REFUNDED', 'FAILED', 'INCOMPLETE_DEPOSIT'];

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface Token {
  /** 1Click asset id, e.g. `nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near`. */
  assetId: string;
  symbol: string;
  /** 1Click `blockchain` value: `near`, `eth`, `pol`, `base`, `arb`, `sol`, `tron`, `btc`, ... */
  chain: string;
  decimals: number;
  /** USD price of ONE whole token as a decimal string ("0.999264"). Display / estimation only. */
  priceUsd: string;
  /** Token contract on its own chain; absent for native assets. */
  contractAddress?: string;
  priceUpdatedAt?: string;
}

export type QuoteKind = 'pay' | 'refund';

export interface Quote {
  /** 1Click `correlationId`, or a `mock-…` id. */
  id: string;
  kind: QuoteKind;
  /** True when this was a preview (`dry: true`): there is NO deposit address and nothing can be paid. */
  dry: boolean;
  originAsset: string;
  destinationAsset: string;
  /** Where the payer sends `amountIn` of `originAsset`. Empty string for dry quotes. */
  depositAddress: string;
  /** Must accompany the deposit when present (memo chains such as Stellar). */
  depositMemo?: string;
  /** Amount of `originAsset` to deposit, minor units. */
  amountIn: string;
  /** Lowest deposit that still executes (EXACT_OUTPUT quotes), minor units. */
  minAmountIn?: string;
  /** Amount of `destinationAsset` delivered, minor units. */
  amountOut: string;
  /** Guaranteed minimum output after slippage, minor units. */
  minAmountOut?: string;
  /** ISO timestamp. The deposit must land before this. */
  deadline: string;
  /** Estimated seconds from confirmed deposit to delivery. */
  timeEstimateSecs?: number;
  /** Untouched provider response (1Click `QuoteResponse`) or mock metadata. JSON-serialisable. */
  raw: unknown;
}

export interface QuotePayParams {
  /** Asset the customer pays with (a `Token.assetId`). */
  originAsset: string;
  /**
   * Amount the merchant must receive, in **USDC minor units** (6 dp) as an
   * integer string: "49000000" = $49.00. NOT a dollar figure, NOT a float.
   */
  amountUsd: string;
  /** Customer's address on the ORIGIN chain; failed swaps are refunded there. */
  refundTo: string;
  /** NEAR account that receives the USDC (the receipt contract). */
  recipientNear: string;
  /** Quote validity in minutes (default 30). */
  deadlineMins?: number;
}

export interface QuoteRefundParams {
  /** USDC (on NEAR) being refunded, minor units (6 dp) integer string. */
  amountUsdc: string;
  /** Asset the customer receives (a `Token.assetId`). */
  targetAsset: string;
  /** Customer's address on the target asset's chain. */
  targetAddress: string;
  /** NEAR account that gets the USDC back if the refund swap fails. */
  refundToNear: string;
  /** Quote validity in minutes (default 30). */
  deadlineMins?: number;
}

export interface SubmitDepositOptions {
  /** Required by 1Click for deposits made on NEAR: the sending account. */
  nearSenderAccount?: string;
  /** Memo used with the deposit, if the quote had a `depositMemo`. */
  memo?: string;
}

export interface IntentsAdapter {
  /** Customer's `originAsset` -> exact `amountUsd` USDC on NEAR, delivered to `recipientNear`. */
  quotePay(p: QuotePayParams): Promise<Quote>;
  /** Exact `amountUsdc` USDC on NEAR -> `targetAsset` delivered to `targetAddress`. */
  quoteRefund(p: QuoteRefundParams): Promise<Quote>;
  status(depositAddress: string, memo?: string): Promise<SwapStatus | string>;
  submitDeposit?(depositAddress: string, txHash: string, opts?: SubmitDepositOptions): Promise<void>;
  listTokens(): Promise<Token[]>;
}

/** USDC on NEAR (native Circle USDC, NEP-141 contract `1720…33a1`), verified in live `GET /v0/tokens`. */
export const USDC_NEAR_ASSET_ID = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const USDC_DECIMALS = 6;
export const DEFAULT_DEADLINE_MINS = 30;
