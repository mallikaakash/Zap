# @uc/intents-adapter

One interface over cross-chain swaps for Zap (SPEC §5):

- `MockAdapter` — deterministic, no network. Used in `local` and `testnet` (NEAR Intents has no testnet).
- `OneClickAdapter` — the real NEAR Intents 1Click API (`https://1click.chaindefuser.com`).
- `TidepoolAdapter` — **experimental**, `OneClickAdapter` pointed at a Tidepool sandbox URL.
- `createAdapter(env)` — picks one from `UC_MODE`.

Source-first ESM TypeScript, zero runtime dependencies (global `fetch`). No build step.

```sh
pnpm --filter @uc/intents-adapter test        # 45 unit tests, no network
pnpm --filter @uc/intents-adapter typecheck
UC_LIVE_DRY_TEST=1 pnpm --filter @uc/intents-adapter test   # + 3 read-only checks against real 1Click (dry quotes only)
```

## Money

Every amount is an **integer in minor units as a decimal string**. `amountUsd: "49000000"` means 49.00 USDC (6 dp) — it is not a dollar figure. Floats, `"49.00"`, `"0"` and numbers are rejected before any network call. All mock maths is `BigInt`.

## Interface

```ts
interface IntentsAdapter {
  quotePay(p: { originAsset: string; amountUsd: string; refundTo: string; recipientNear: string; deadlineMins?: number }): Promise<Quote>;
  quoteRefund(p: { amountUsdc: string; targetAsset: string; targetAddress: string; refundToNear: string; deadlineMins?: number }): Promise<Quote>;
  status(depositAddress: string, memo?: string): Promise<SwapStatus | string>;
  submitDeposit?(depositAddress: string, txHash: string, opts?: { nearSenderAccount?: string; memo?: string }): Promise<void>;
  listTokens(): Promise<Token[]>;
}

interface Quote {
  id: string;                 // 1Click correlationId or "mock-…"
  kind: 'pay' | 'refund';
  dry: boolean;               // true = preview only, depositAddress is ''
  originAsset: string; destinationAsset: string;
  depositAddress: string; depositMemo?: string;
  amountIn: string; minAmountIn?: string;
  amountOut: string; minAmountOut?: string;
  deadline: string;           // ISO
  timeEstimateSecs?: number;
  raw: unknown;               // full provider response / mock metadata
}

interface Token { assetId: string; symbol: string; chain: string; decimals: number; priceUsd: string; contractAddress?: string; priceUpdatedAt?: string }

type SwapStatus = 'PENDING_DEPOSIT' | 'KNOWN_DEPOSIT_TX' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED';
```

- `quotePay`: customer's `originAsset` → **exactly** `amountUsd` USDC on NEAR to `recipientNear`. `amountIn` is what the customer must send. `refundTo` is the customer's address on the origin chain. Default deadline 30 minutes.
- `quoteRefund`: exactly `amountUsdc` USDC on NEAR → `targetAsset` to `targetAddress`. The USDC is deposited **from NEAR** (`ft_transfer` to `depositAddress` on the USDC contract).
- Also exported: `USDC_NEAR_ASSET_ID`, `TERMINAL_STATUSES`, `isTerminalStatus`, `isMockAdapter`, `MOCK_TOKENS`, `fakeDepositAddress`, `dryQuotePriceSource`, `parseMode`, `OneClickError`.

## Modes — `createAdapter(env = process.env, overrides?)`

| `UC_MODE` | Returns | Network |
|---|---|---|
| `local` (default, also when unset) | `MockAdapter`, fixed price table | none |
| `testnet` | `MockAdapter` whose amounts come from a 1Click **dry** quote; fixed table if 1Click is unreachable, rejects the request, or takes > 8 s | read-only dry quotes |
| `testnet` + `TIDEPOOL_URL` | `TidepoolAdapter` (experimental, see below) | your Tidepool |
| `live` | real `OneClickAdapter` — **throws unless `CONFIRM_REAL_MONEY === 'yes'`** | real money |

Env read: `UC_MODE`, `ONECLICK_BASE_URL`, `ONECLICK_JWT`, `TIDEPOOL_URL`, `CONFIRM_REAL_MONEY`. `overrides`: `{ fetch?, mock?: MockAdapterOptions }`.

```ts
const adapter = createAdapter(process.env, {
  mock: {
    onDeliver: async ({ recipientNear, amountOut }) => { /* mint mock USDC to the receipt contract */ },
    onRefundDelivered: async ({ targetAddress, amountOut }) => { /* log the fake refund */ },
  },
});
const quote = await adapter.quotePay({ originAsset, amountUsd: '49000000', refundTo, recipientNear });
if (isMockAdapter(adapter)) await adapter.simulatePayment(quote.depositAddress);
```

## MockAdapter

`new MockAdapter({ tokens?, feeBps? = 30, seed?, usdcNearAssetId?, priceSource?, priceSourceTimeoutMs? = 8000, onDeliver?, onRefundDelivered?, store?, now? })`

- `listTokens()` — 14 fixed assets (USDC on NEAR/Base/Solana/Arbitrum/Ethereum, USDT on Polygon/Ethereum/Tron, ETH on Ethereum/Base, BTC, SOL, wNEAR, POL). Asset ids, chains and decimals are copied from the real token list; prices are a frozen snapshot with stablecoins at exactly $1.
- Pay: `amountIn = ceil(ceil(usdcOut × 10^dec / price) × (1 + fee))`. Refund: `amountOut = floor(floor(usdcIn × 10^dec / price) × (1 − fee))`. The payer never underpays and the merchant gets exactly `amountUsd`.
- Deposit addresses are **fake**, shaped for the origin chain (EVM `0x…`, Solana base58, `bc1q…`, Tron `T…`, 64-hex NEAR implicit account for refunds), deterministic from seed + counter + clock + inputs. **Never present them as payable on a real chain.**
- `priceSource(req) => Promise<{ amountIn, amountOut, minAmountIn?, minAmountOut? } | null>` — optional real pricing. Ignored (table used) if it throws, times out, returns nothing, returns non-integer strings, or does not honour the exact amount requested.
- `status()` — `PENDING_DEPOSIT → (KNOWN_DEPOSIT_TX after submitDeposit) → PROCESSING → SUCCESS`. An unpaid quote past its deadline reports `FAILED`. Unknown addresses throw.
- `simulatePayment(depositAddress)` — pay quotes only. Calls `onDeliver({ quote, recipientNear, amountOut })`, then `SUCCESS`. Idempotent (never delivers twice, including concurrent calls in one process). Past the deadline it becomes `REFUNDED` with no delivery. If `onDeliver` throws, the status is rolled back and the error rethrown, so it can be retried.
- `simulateRefundDelivery(depositAddress)` — same for refund quotes, calls `onRefundDelivered({ quote, targetAsset, targetAddress, amountOut })`.
- `getRecord(depositAddress)` — stored quote, recipient, status, deposit tx hash.

### Sharing state between processes

Two options:

1. `exportState()` → JSON-safe `{ version: 1, counter, records }`; `importState(stateOrJson)` replaces the in-memory store.
2. Pass `store: { get(depositAddress), put(record) }` backed by a DB table keyed by deposit address. Every read and write then goes through it, so the web app and worker see the same swaps. (`exportState`/`importState` throw in this setup — the store is the state.)

Known limits: the double-delivery guard is per process. Two processes calling `simulatePayment` on the same address in the same instant could both deliver; a process that dies inside `onDeliver` leaves the record at `PROCESSING`.

## OneClickAdapter

`new OneClickAdapter({ baseUrl?, jwt?, apiKey?, dry? = false, fetch?, usdcNearAssetId?, slippageBps? = 100, quoteWaitingTimeMs? = 3000, referral?, timeoutMs? = 20000, now? })`

- `dry: true` sends **every** quote with `dry: true`: no deposit address, nothing can be paid. The returned `Quote` has `dry: true`, `depositAddress: ''`, and echoes the requested deadline.
- `jwt` → `Authorization: Bearer …`. `apiKey` → `X-API-Key` (the OpenAPI calls this the recommended scheme and JWT bearer "legacy"; there is no env var for it yet).
- `statusDetails(depositAddress, memo?)` returns the full status body, including `swapDetails.originChainTxHashes` / `destinationChainTxHashes` (`{ hash, explorerUrl }`) for `proof.json`.
- Non-2xx responses throw `OneClickError` (`httpStatus`, `path`, `body`). `quotePay` also throws if 1Click returns an `amountOut` different from the amount requested.

### What was verified, and how (2026-11-11)

Against the OpenAPI spec (`https://1click.chaindefuser.com/docs/v0/openapi.yaml`) **and** live responses:

- `GET /v0/tokens` (live): array of `{ assetId, decimals, blockchain, symbol, price (number), priceUpdatedAt, contractAddress?, coingeckoId? }`.
- **USDC on NEAR** = `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (live token list: `blockchain: "near"`, `symbol: "USDC"`, 6 decimals). Polygon USDT = `nep141:pol-0xc2132d05d31c914a87c6611c10748aeb04b58e8f.omdep.near`.
- `POST /v0/quote` with `dry: true` (live, both directions, returns HTTP **201**). Required request fields: `dry, swapType, slippageTolerance, originAsset, depositType, destinationAsset, amount, refundTo, refundType, recipient, recipientType, deadline`. Response: `{ correlationId, timestamp, signature, quoteRequest, quote: { amountIn, amountInFormatted, amountInUsd, minAmountIn, amountOut, amountOutFormatted, amountOutUsd, minAmountOut, timeEstimate, refundFee, withdrawFee } }`.
- `EXACT_OUTPUT` to USDC on NEAR returned `amountOut` equal to the requested amount; `amountIn` carries the slippage buffer and `minAmountIn` is the real minimum (the excess is refunded to `refundTo`).
- `slippageTolerance` must be an integer 0–10000 and `amount` an integer string (live validation errors).
- Live address validation: a malformed `refundTo`/`recipient` gets HTTP 400. A NEAR recipient that **does not exist on mainnet** (e.g. `*.testnet`) gets HTTP 400 `"Internal server error"`. That is why the testnet price source swaps the NEAR account for `example.near` in its dry quotes.
- `GET /v0/status` (live, unknown address only): 404 `{ message: "Deposit address … not found" }`.

From the OpenAPI spec only (not exercised live, because that needs a real quote):

- Non-dry quote fields `quote.depositAddress`, `quote.depositMemo`, `quote.deadline`, `quote.timeWhenInactive`.
- `GET /v0/status?depositAddress=…&depositMemo=…` success body `{ correlationId, status, updatedAt, quoteResponse, swapDetails }` and the status enum above.
- `POST /v0/deposit/submit` body `{ txHash, depositAddress, nearSenderAccount?, memo? }`.

### Still unverified

- The whole non-dry path (real deposit address, status polling to `SUCCESS`, deposit submit). It will first run in `scripts/mainnet-proof`.
- JWT / API-key authentication: no key was available. Without one, 1Click adds its unauthenticated fee.
- Refund leg mechanics on NEAR: `depositType: ORIGIN_CHAIN` with `ft_transfer` to the deposit address follows the 1Click reference notes, but was not executed.
- Whether `recipientNear` must already be storage-registered on the USDC contract for delivery. Register the receipt contract before the mainnet proof.
- `TidepoolAdapter` has never been run against a Tidepool instance; only its URL handling is tested.
