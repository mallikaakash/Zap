# Deployment

## Local / demo (default)

```bash
pnpm demo
```

- Starts NEAR **sandbox** (binary download on first run ~60 MB)
- Deploys `contracts/artifacts/*.wasm`
- Mock Intents + SQLite DB + Next.js + settlement worker

No real funds, no RPC API keys required.

## Contract WASM rebuild

```bash
pnpm build:contracts
```

Requires Rust 1.97.1, `cargo-near`, `wasm32-unknown-unknown`.

## Mainnet (operator only)

**Authoritative checklist:** `docs/GO-LIVE.md`

```bash
pnpm deploy:mainnet        # shows plan; needs --yes to execute
pnpm start                 # production processes
```

**Economics (from README):** ~5.5 NEAR total deploy, much as storage stake.

### Pre-deploy gates

- [ ] Contract audit skill reviewed
- [ ] `.env` secrets on host only
- [ ] Executor key is function-call limited
- [ ] Intents API credentials for live adapter
- [ ] HTTPS for web app

## Testnet

NEAR testnet deploy is supported by **near-cli-rs** / `cargo near` for contract iteration, but **Intents will not match production** — use sandbox demo for integrated tests.

Example view-only sanity check:

```bash
near contract call-function as-read-only <contract.testnet> get_status \
  json-args '{}' network-config testnet now
```

## Agents

- **Never** run `deploy:mainnet` or fund accounts without explicit user approval
- Document tx hashes and contract IDs only after verified on explorer

## Rollback

- Contract upgrades require defined migration methods — no silent WASM swap
- Off-chain: revert deployment env vars and worker version
