# Chain Signatures and multichain accounts

**Status:** Ecosystem capability — **not required** for current Zap MVP. Documented for future architecture (seller payout to EVM, agent wallets).

## Official starting points

| Resource | URL | Verified 2026-11-13 |
| -------- | --- | --------------------- |
| NEAR docs — Chain Signatures | https://docs.near.org/chain-abstraction/chain-signatures | Conceptual + integration |
| MPC network / multisig contract | Documented in NEAR docs (contract IDs network-specific) | Verify on testnet before mainnet |
| near-hydra (CLI + MCP) | https://github.com/near/near-hydra | Optional agent tooling (`docs/OPTIONAL_MCP.md`) |
| Skill rules | `.agents/skills/near-smart-contracts/rules/chain-signatures.md` | Patterns for contracts |

## What Chain Signatures provides

- NEAR account can request **derived keys** on foreign chains (BTC, ETH, etc.) via MPC service.
- Enables **one NEAR identity** to control external-chain addresses with policy constraints.

## Security implications

| Risk | Mitigation |
| ---- | ---------- |
| MPC service availability | Fallback paths; monitor liveness |
| Derivation path / policy bugs | Testnet drills; audit contract allowlists |
| Phishing of NEAR account with CS permission | Limit function-call keys; human approval for policy changes |

## Relevance to Zap

| Use case | Fit |
| -------- | --- |
| Customer pay-in on EVM | Already via **Intents**, not Chain Signatures |
| Refund to EVM | **Intents** 1Click |
| Seller payout to preferred chain | **Planned** (README) — Chain Signatures or Intents withdraw APIs may apply |
| TEE executor | Separate track (OutLayer) |

## Recommendation

- Do not add Chain Signatures dependencies until product spec chooses payout rail.
- When needed, prototype on **testnet MPC** with unfunded keys first; use `near-hydra` MCP only with read-only or test accounts.

## Unresolved questions

- Cost/latency vs pure Intents withdrawal for seller payouts
- Compliance implications of MPC-hosted keys per jurisdiction
