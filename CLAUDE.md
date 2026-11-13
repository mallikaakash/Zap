# CLAUDE.md — Universal Checkout

Read `SPEC.md` before any work. It is the source of truth; if code and spec disagree, ask before changing the spec.

## Ground rules
- **Live mode is allowed; only the human moves real money.** The product runs for real on NEAR mainnet with real NEAR Intents (`UC_MODE=live`, `CONFIRM_REAL_MONEY=yes`). `local` stays the default for development and tests. Claude may write and test live-mode code, but must not deploy to mainnet, fund accounts, send payments, or run anything that signs a mainnet transaction; the human runs `pnpm deploy:mainnet` and pays with their own wallet. Claude may call the 1Click API only for `dry: true` quotes and read-only endpoints (tokens, status).
- **Never handle private keys or seed phrases.** Don't print, store or commit them. Testnet keys come from the near-cli-rs keychain or files outside the repo.
- **No secrets in git.** Update `.env.example` whenever you add a variable.
- **The local path must always work:** after every milestone, `pnpm install && pnpm demo` on a clean checkout with no env vars (local sandbox, simulated swaps) — it is the safety net and the test bed. If you break it, fix it before moving on.
- **README only claims what works.** Unfinished items go under "Planned".
- When an external API detail is uncertain (1Click fields, NEAR AI Cloud endpoint, OutLayer CLI, Shopify extension APIs), check the official docs or OpenAPI spec first; if you can't, isolate it behind an interface and leave a `// VERIFY:` comment.

## Workflow
- Work through `SPEC.md` §12 in order. One block at a time: plan → implement → test → tick the box in SPEC.md → commit.
- Small commits with clear messages. Run `pnpm test` before each commit.
- Prefer boring, well-known tools: near-sdk (Rust) + near-contract-standards, near-workspaces for sandbox tests, Next.js App Router, Prisma, Vite lib mode for the web component.
- Ask the human only for decisions that change scope or need their accounts (testnet accounts, Vercel, NEAR AI key). Otherwise make the sensible choice and note it in `DECISIONS.md`.

## Commands
- `pnpm demo` — sandbox end-to-end, no keys
- `pnpm test` — all tests
- `pnpm dev` — web + worker in current mode
- `pnpm deploy:testnet` — needs testnet accounts in env

## Style
- TypeScript strict. Rust: `cargo clippy` clean.
- Money is integer minor units (USDC 6 dp) everywhere; never floats.
- Timestamps in ns on-chain, ISO strings off-chain.
