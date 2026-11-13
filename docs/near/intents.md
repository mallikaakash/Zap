# NEAR Intents (1Click)

**Official docs:** https://docs.near-intents.org  
**Skill:** `.agents/skills/near-intents/`  
**Repo adapter:** `packages/intents-adapter/`

## Status (2026-11-13)

| Fact | Source |
| ---- | ------ |
| 1Click REST API for quotes and swap execution | Intents docs + adapter |
| **No Intents testnet** | Root `README.md` |
| Live swaps on **mainnet** only | `MODE=live` / `pnpm deploy:mainnet` |
| Local dev uses **mock adapter** | `packages/intents-adapter/src/mock.ts` |

## Architecture in Zap

- **Pay-in:** Customer pays any supported asset; 1Click `EXACT_OUTPUT` delivers USDC to receipt contract.
- **Pay with USDC on NEAR:** `ft_transfer_call` path without swap.
- **Refund-out:** Approved refunds quoted and executed via 1Click back to customer's origin chain/asset.

## Adapter interfaces

| File | Mode |
| ---- | ---- |
| `src/factory.ts` | Selects mock vs live from env |
| `src/mock.ts` | Mints mock USDC, simulates refund delivery |
| Real implementation | Calls 1Click per skill rules |

## Security and operations

- Log and store **quote IDs** on-chain where contract requires (`DECISIONS.md`).
- Slippage buffers — document economic risk on volatile routes.
- Executor attributes plain USDC transfers to orders (`mint_receipt`) — public verification at `/verify`.

## Limitations

- Cannot integration-test real Intents in CI without mainnet credentials and funds (tests skip or mock).
- Asset list changes over time — do not hardcode without refresh from API (`near-intents` skill token endpoints).

## Relevance to agents

- Use `near-intents` skill for HTTP shapes; never invent endpoint paths.
- For local work, always assume **mock** unless operator explicitly runs live mode.

## Experimental

- Confidential swaps API rules in skill — evaluate if needed for merchant privacy (not MVP).
