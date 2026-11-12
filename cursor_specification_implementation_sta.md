# Specification implementation status
_Exported on 12/11/2026 at 9:12:36 GMT+5:30 from Cursor (3.29.15)_

---

**User**

how much of the spec has been implemented and how asnd how accurately. what are the mocks and the stubs

---

**Cursor**

Comparing the codebase to `SPEC.md` and locating mocks and stubs.




Here is a concise audit against `SPEC.md` (checklist in section 12 is still all unchecked, but a lot of the code is in place). Tests currently pass: TypeScript packages (150 tests) and Rust (9 sandbox integration tests + ~74 unit tests in `contracts/receipts/src/tests.rs`).

## Overall progress (by sprint block)

| Block | Spec intent | Rough completion | Notes |
|--------|-------------|------------------|--------|
| **A — Foundation** | Monorepo, mock USDC, prebuilt WASM, `pnpm demo` | **~85%** | Real UC layout (`contracts/`, `apps/web`, `packages/*`, `services/settlement`). Committed `contracts/artifacts/*.wasm`. `pnpm demo` spins sandbox via `near-kit`, SQLite, web + worker. **Gaps:** no CI; sandbox docker fallback is only mentioned in errors, not implemented; root **README is still the old NEAR auction starter**, not Universal Checkout. |
| **B — Receipt contract** | Full escrow NFT + refund state machine | **~95%** | Methods align with `contracts/INTERFACE.md` (binding doc). Sandbox tests cover mint gating, `ft_on_transfer`, release/rollback, AI refund path, signatures, cancel, caps, pause. **Gaps:** no automated “CI rebuild WASM hash” check; spec’s **physical goods → release on delivered + N days** has no `productType` / enforce-on-release in app or contract. |
| **C — Local payment path** | Mock swaps → worker → UI | **~85%** | `MockAdapter`, sessions/Prisma, settlement worker, checkout + simulate, receipt page + chat, webhooks, `/verify`, direct USDC path, min order, refund blocklist/rate limit, fulfilment for triage. **Gaps:** merchant actions use **demo-custodial keys**, not wallet selector (SPEC §9c #9); refund **photos are filename-only**; physical-goods release rules absent. |
| **D — Merchant + button** | `<pay-button>`, dashboard, shop | **~90%** | `@uc/sdk` web component (92 tests), dashboard styler + QR/link, demo shop (3 products). **`pay.js` is gitignored** — built via `apps/web`’s `sdk` script, not wired into `pnpm demo` (shop uses in-app loader to `/pay.js`). |
| **E — Integrations** | WooCommerce, MCP, Shopify | **~0%** | No `plugins/`, no `services/mcp` checkout server (`docs/OPTIONAL_MCP.md` is only Cursor NEAR MCP docs). |
| **F — AI refund agent** | Chat + NEAR AI + on-chain `ai_decide` | **~70%** | Rule-based `triage` (`packages/core/src/refund-agent.ts`), receipt chat UI, worker posts `ai_decide` / finalize / `execute_refund`. NEAR AI Cloud used when `NEARAI_API_KEY` is set. **Gaps:** images not uploaded/analysed; no separate `POST …/dispute` route (messages API instead). |
| **G — Testnet + proof** | Deploy, hosted demo, mainnet proof | **~15%** | `OneClickAdapter` + dry quotes for **pricing** in `testnet` mode; `TidepoolAdapter` is URL plumbing only. **Missing:** `pnpm deploy:testnet`, `pnpm proof:mainnet`, hosting, live swap path in product. |
| **H — Ship** | README, video, submission | **~15%** | `DECISIONS.md` documents deviations; SPEC checkboxes untouched; README not product-facing. |

**Cut-line MVP (A–D + refund story):** roughly **75–85%** of what judges can run locally (`pnpm demo` → shop → simulate pay → receipt → refund chat → mock refund). **Stretch (E, G, H, real Intents, WooCommerce):** largely not built.

---

## How closely it matches the spec

**Strong alignment**

- **Architecture in `local` mode** matches the diagram: Next API + Prisma, settlement worker, receipt contract, intents **interface** with mock implementation.
- **Contract behavior** tracks revised SPEC §4 / §8 / §9b via `INTERFACE.md` (ed25519 receipt-key preimages, `mint_receipt` balance callback, rollback on failed FT transfer, refund request state machine including AI path).
- **Two payment paths** (per `DECISIONS.md`): mock swap → USDC in contract → `mint_receipt`; direct NEAR USDC → `ft_on_transfer`.
- **Security story for customers:** private receipt key stays in URL fragment; backend relays signed calls.
- **Mode switch `UC_MODE`:** `local` / `testnet` / `live` with `CONFIRM_REAL_MONEY=yes` guard for real 1Click.

**Documented deviations** (`DECISIONS.md`)

- **Demo-custodial NEAR accounts** instead of merchant/customer wallet signing.
- **`order_ref` on-chain** = hash of merchant + order id (PII off-chain).
- **`customer_reply_secs`, min order, refund-address limits/blocklist** enforced off-chain, not in the contract.
- **Mock refunds to non-NEAR targets** do not move coins on another chain — they log / mark delivered in the adapter.

**Weaker or missing vs spec**

- **Cross-chain is simulated** in default modes (by design in SPEC §1).
- **1Click primary path** (customer pays deposit address → contract) is **not** what mock mode exercises; mock **mints USDC on NEAR** instead.
- **Physical goods release policy**, **OutLayer**, **Shopify/WooCommerce**, **mainnet proof script**, **hosted testnet**, **MCP checkout tools** — not implemented.
- **README / judge path:** spec says README should describe UC and `pnpm demo`; repo root README still describes the template auction app.

---

## Mocks and stubs (what is fake vs real)

### On-chain / money

| Piece | What it is |
|--------|------------|
| **`contracts/mock-usdc`** | NEP-141 **faucet token** (open `mint`). No economic value. |
| **`MockAdapter` deposit addresses** | **Fake** Base58-style addresses — must not send real funds (`packages/intents-adapter/src/mock.ts`). |
| **`simulatePayment` / `simulateRefundDelivery`** | Flip in-memory (DB-backed) swap status; **`onDeliver`** mints mock USDC to the **receipt contract** (`packages/core/src/runtime.ts`). |
| **`execute_refund` in mock** | USDC moves on NEAR to a mock deposit account; **“delivery” back to Polygon/etc.** is **logged** (`mock_refund_delivered` event), not a real reverse swap. |
| **Sub-minimum cross-chain refund** | Real path: pay as USDC on NEAR (`quote_id = "direct-usdc"` in settlement). |

### Swaps / Intents

| Piece | What it is |
|--------|------------|
| **`local`** | `MockAdapter` + fixed price table — **no network**. |
| **`testnet`** | Still **`MockAdapter` for execution**; prices may come from **1Click dry quotes** only (`dryQuotePriceSource`). |
| **`live`** | **`OneClickAdapter`** with `dry: false` — **real money**; blocked unless `CONFIRM_REAL_MONEY=yes`. **Not used by `pnpm demo`.** |
| **`TidepoolAdapter`** | Subclass of `OneClickAdapter`; **never run against a real Tidepool** (tests only URL handling). |

### Accounts / signing

| Piece | What it is |
|--------|------------|
| **`.uc/runtime.json` keys** | Throwaway executor, relayer, demo merchant/customer keys for the sandbox run. |
| **`ensureDemoAccount` / `ensureSigner`** | App creates and holds subaccounts; merchant approve/veto/refund APIs work only for those demo-held accounts. |

### AI / UX stubs

| Piece | What it is |
|--------|------------|
| **Refund agent without `NEARAI_API_KEY`** | Deterministic **rule-based** triage (same JSON shape as the model). |
| **Refund chat photos** | **Filename only** — no upload, storage, or vision (`DECISIONS.md`, receipt UI copy). |
| **`UC_TIME_SCALE`** | Compresses schedule/window time on sandbox (e.g. 30 “days” in ~1 minute) — labeled in UI, not for live. |
| **`/verify`** | For mock `quoteId`, recipient matching is **skipped** (`simulated: true` in core). |

### Infrastructure stubs

| Piece | What it is |
|--------|------------|
| **`/api/dev/webhook-sink`** | Catches outbound webhooks in demo. |
| **`/api/sessions/:id/simulate`** | Judge “Simulate payment” — calls mock adapter only. |
| **`/api/dev/fast-forward`** | Moves sandbox chain time — local only. |

### Not built (would be real in a full ship)

- **`plugins/woocommerce`**, **`services/mcp`** (checkout MCP from SPEC §10)
- **`scripts/mainnet-proof.ts`**, **`pnpm deploy:testnet`**
- **NEAR Intents live deposit/status loop** in the main product flow (only adapter code + guarded `live` mode)

---

## Accuracy summary

The **escrow, NFT receipt, refund state machine, and local judge demo** are implemented **substantially and test-backed** relative to the revised contract interface. What is **accurate in demo** is: USDC held in a real (sandbox) contract, real contract rules for release/refund/AI approval, and a full off-chain session/worker loop.

What is **not accurate to “pay any coin on any chain”** in default modes: **origin-chain pay-in and refund-out are simulated**; only NEAR mock USDC and adapter state change. Pricing in `testnet` can be **partially real** (dry quotes) while settlement remains mock.

If useful, I can turn section 12 of `SPEC.md` into checked items with `[x]` / partial notes, or produce a gap list ordered by hackathon cut-line (what to ship before 14 Nov vs what to leave in “Planned”).

---

**User**

i want a real product. it is possible to improve this into one right. how much effort estimated

---

**Cursor**

Checking how complete the live Intents path and deployment tooling are — that drives most of the effort to ship a real product.


Yes — this is a reasonable base for a real product, not a throwaway demo. The expensive shape is already there: escrow receipt contract with tests, settlement worker, session API, checkout and receipt UX, web component, refund state machine plus AI triage. What you have today is roughly a **working escrow + checkout platform on a fake rail** (mock USDC and mock cross-chain). Turning it into something merchants can trust is mostly **swap in real Intents, replace demo custody with wallets, harden ops, and clear legal/compliance** — not a rewrite.

---

## What “real product” can mean (pick a tier)

| Tier | What buyers get | vs today |
|------|-----------------|----------|
| **1 — Credible product** | Hosted app, real wallet signing, testnet (or mainnet-readonly) with **dry quotes**, honest docs, CI, one **mainnet proof** tx | Still mock settlement on testnet; proves architecture |
| **2 — Pilot (real money)** | Merchants on **mainnet**, customers pay via **real 1Click** deposits, refunds via **real reverse swaps**, monitored executor | Core rail is real; few merchants, manual ops |
| **3 — SaaS** | Self-serve onboarding, WooCommerce (or Shopify workaround), webhooks SLAs, refund evidence storage, policies, support | Repeatable merchant acquisition |
| **4 — Regulated payments** | Licensing / MSB / geography, KYC as required, audits, insurance | Mostly legal and ops, not another sprint of features |

Most teams should aim for **1 before the hackathon deadline**, then **2** as the first “we move real USDC” milestone. **3** is when it feels like a company. **4** is parallel to engineering and often dominates timeline.

---

## Why the prototype is a good foundation

**Reuse as-is (high value):**

- Receipt contract logic and sandbox integration tests  
- Refund request state machine + worker loop (`mint` → `release` → `ai_decide` → `execute_refund`)  
- Receipt-key signing model (customer doesn’t need NEAR for first actions)  
- Prisma session model, webhooks, `/verify` concept  
- `OneClickAdapter` (HTTP client + tests); factory already switches `live` with `CONFIRM_REAL_MONEY`  

**Replace or finish (expected product work):**

- `MockAdapter` → live status polling + production error handling (underpay, expired, stuck)  
- Demo-custodial accounts → **NEAR wallet** for merchants (and optional customer NEAR)  
- Missing `deploy:testnet`, `proof:mainnet`, hosting, monitoring  
- Stubs: refund **photos**, mock **cross-chain refund delivery**, optional Tidepool  
- Root **README** still describes the old starter, not Universal Checkout  

The adapter README is explicit: the **non-dry 1Click path is coded but not exercised end-to-end** in the app yet — that’s the main integration gap, not the contract.

---

## Effort estimate (engineering)

Assuming **one strong full-stack dev** comfortable with NEAR + TypeScript. Add ~30–50% for part-time or learning curve. **Does not include** legal, formal audit fees, or design polish.

### Tier 1 — Credible product (~**1–2 person-weeks**)

| Work | Effort |
|------|--------|
| Product README, `.env.example`, judge path (`pnpm demo` + build `pay.js` in demo) | 1–2 d |
| CI: `pnpm test`, `cargo test`, optional WASM hash check | 1–2 d |
| `deploy:testnet` + Vercel + Neon Postgres | 2–3 d |
| Merchant **wallet connect** (approve/veto/register); drop custodial for hosted | 3–5 d |
| Polish checkout (token list from live API when available, clear simulated vs real badges) | 2–3 d |

**Outcome:** Something you can put in a submission deck and give to a design partner **without** saying “everything is fake” — escrow on testnet is real; swaps still mocked unless you run Tier 2.

### Tier 2 — Pilot with real money (~**+3–5 person-weeks** after Tier 1**

| Work | Effort |
|------|--------|
| Wire settlement + checkout to **live** `OneClickAdapter` (`UC_MODE=live`, guarded) | 4–6 d |
| `scripts/mainnet-proof.ts` + README proof links (SPEC §9) | 2–3 d |
| Primary path: quote `recipient` = receipt contract; verify OpenAPI `msg` / `ft_transfer_call` (**VERIFY** in spec) | 2–4 d |
| Executor key hygiene (HSM or locked-down keychain, no keys in env on Vercel) | 2–4 d |
| Refund leg: real quotes, storage_deposit, poll to SUCCESS, `/verify` against 1Click | 3–5 d |
| Observability: structured logs, alerts on stuck sessions, worker restarts | 2–3 d |
| **Informal** contract review + fix critical findings | 3–5 d |

**Outcome:** A **small pilot** ($ caps, allowlisted merchants). Still not self-serve SaaS.

### Tier 3 — Merchant SaaS (~**+6–10 person-weeks**)

| Work | Effort |
|------|--------|
| WooCommerce plugin + docker test store (SPEC §10) | 1–2 w |
| Refund evidence (S3/R2, signed URLs, optional vision later) | 3–5 d |
| Merchant onboarding, API keys, webhook secrets, dashboard hardening | 1–2 w |
| Physical-goods release rules, min order, blocklist (spec §9c gaps) | 3–5 d |
| Rate limits, abuse, backup/restore, Postgres migrations at scale | 1 w |
| Optional: MCP checkout server, Shopify thank-you extension | 1–2 w each |

**Outcome:** “Install and take crypto checkout” for early merchants — still with stated trust assumptions (executor, Intents).

### Tier 4 — Compliance-heavy “real fintech” (**months–years**, mostly non-engineering)

Legal opinion, geography, MSB/partner model, insurance, **formal audit**, incident response, SOC2 if enterprise. Engineering might add **1–2 months** for changes auditors require. Don’t block Tier 2 on Tier 4 if you label it **beta / unaudited** and cap exposure.

---

## Calendar-style totals

| Goal | Eng only (1 dev) | Small team (2 devs + part-time legal) |
|------|------------------|----------------------------------------|
| Hackathon-grade **real story** (Tier 1 + scripted mainnet proof) | **~2 weeks** | **~1 week** |
| **Pilot** with real swaps + a few merchants | **~1.5–2 months** | **~3–5 weeks** |
| **SaaS** WooCommerce + onboarding | **~3–4 months** | **~2–2.5 months** |

Parallelizing helps Tier 3 (plugin vs wallet vs live Intents), but **live 1Click end-to-end** should be one owner first — it touches checkout, worker, and verify together.

---

## Highest-leverage order

1. **End-to-end live 1Click on mainnet** with hard caps (even before pretty hosting) — proves the wedge.  
2. **Wallet signing for merchants** — removes the biggest “this is a toy” signal.  
3. **Hosted testnet + honest README** — distribution and trust.  
4. **WooCommerce** — proves “any site” for the story.  
5. Formal audit when you have merchants and volume, not before a cap-limited pilot.

---

## Honest constraints

- **NEAR Intents has no testnet** — you either mock (current) or use **mainnet 1Click** with small amounts for real integration tests.  
- **Executor trust** is explicit in the spec; a “real product” copy should say that and point to `/verify`; OutLayer/TEE is Phase 2, not required for pilot.  
- **Cross-chain refunds** are the fragile leg — budget extra time for edge cases (minimums, failed swaps, exchange addresses).  

**Bottom line:** Improving this into a **real pilot product** is very plausible in **~6–8 weeks** of focused engineering after the hackathon; into **merchant SaaS** in **~3–4 months**. The contract and app architecture are not the bottleneck — **live Intents wiring, custody model, ops, and compliance framing** are.

If you say which tier you care about (hackathon demo only vs paid pilot vs SaaS), I can turn this into a ordered backlog tied to `SPEC.md` §12 with concrete tasks and owners.

---

**User**

I want to be able to demo in one day using a real Metamask wallet from where I can deposit Polygon USDT on a website in which I can just add the code it's like a few lines code snippet - button add, and the other market tier guy, and then I can use the Metamask wallet pretending to be the customer to pay at the website checkout. Is that possible?

---

**Cursor**

Tracing the live checkout path and embed flow to see what’s already wired for a MetaMask + Polygon USDT demo.


**Yes — that demo is possible**, and most of the product shape already matches it: embed snippet → hosted checkout → real **Polygon USDT** deposit from MetaMask → escrow receipt on NEAR. It is **not** a one-command flow today; you need **mainnet + live 1Click** and a few gaps closed first. NEAR Intents has **no testnet**, so Polygon USDT from MetaMask only works on the **real** swap rail (small real money).

---

## What you described vs what exists

| Step | Ready today? |
|------|----------------|
| Merchant page: few lines + `<pay-button>` | **Yes** — `@uc/sdk` → `pay.js`, CORS on `/pay.js` and `/api/sessions` |
| Button opens checkout (iframe/modal) | **Yes** |
| Customer picks **Polygon USDT**, enters **MetaMask refund address** | **Yes** |
| Checkout shows **deposit address + exact amount + QR** | **Yes** |
| Customer sends USDT in **MetaMask** (manually: copy address/amount; app does not “Connect wallet” yet) | **Yes** — normal for 1Click |
| Backend polls 1Click → mints receipt on NEAR | **Wired** in `settlement` when `UC_MODE=live` |
| Merchant dashboard | **Yes** in demo/local; **not** aligned with a one-day live setup |

So the story you want is the **intended** product path. What’s missing is **ops and live-mode bootstrap**, not a second greenfield app.

---

## Why `pnpm demo` is not enough

`pnpm demo` is **local sandbox + mock swaps**. MetaMask on **Polygon** must pay a **real** 1Click deposit address. That requires roughly:

1. **`UC_MODE=live`** and **`CONFIRM_REAL_MONEY=yes`**
2. **Mainnet** receipt contract pointing at **real mainnet USDC** (not `mock-usdc`)
3. Receipt contract **storage-registered** on that USDC contract
4. **Executor** NEAR account with a key the worker can use
5. **Worker + web** running while you pay (polls `/v0/status`)
6. **`PUBLIC_URL`** reachable from your browser (and for embed: **HTTPS** — e.g. ngrok, Cloudflare Tunnel, or Vercel)

There is **no** `deploy:testnet` / mainnet deploy script or `proof:mainnet` in the repo yet; that’s manual `near` / `near-kit` for a one-day push.

---

## One-day plan (real MetaMask + embed)

Assume you already have: a **mainnet NEAR** account (~5–10 NEAR), **Polygon USDT** (~$5–20), a little **POL** for gas, and a few hours.

### Morning — wire mainnet (3–5 hours)

1. Deploy `receipts.wasm` to something like `receipts.<your>.near`.
2. Set contract `usdc` to **mainnet USDC** (the NEP-141 id 1Click uses — same as in `packages/intents-adapter` docs).
3. `storage_deposit` for the receipt contract on USDC; fund and fund **executor**.
4. **Seed one merchant** in DB + `register_merchant` on chain.  
   **Blocker today:** `registerMerchant()` always uses demo subaccounts; in **live** mode that path **throws**. For one day you either:
   - manually `register_merchant` + insert a Prisma row, or  
   - a tiny code change to register with **your** NEAR account id you control.
5. Env, e.g. `UC_MODE=live`, `CONFIRM_REAL_MONEY=yes`, mainnet RPC, contract ids, executor key (local only, not committed).

### Midday — host + embed (1–2 hours)

1. `pnpm install`, DB (`prisma db push`), build `pay.js` (`apps/web` `sdk` script).
2. Run **web** + **settlement worker**.
3. Tunnel: `https://abc.ngrok.app` → `PUBLIC_URL`.

**“Other website” test page:**

```html
<!DOCTYPE html>
<html>
  <head>
    <script src="https://YOUR-TUNNEL/pay.js" defer></script>
  </head>
  <body>
    <h1>My fake merchant store</h1>
    <pay-button
      merchant="YOUR_MERCHANT.near"
      amount="5"
      product="Demo mug"
      api="https://YOUR-TUNNEL"
    ></pay-button>
  </body>
</html>
```

Open that file or any static host; click → checkout on **your** backend (modal/redirect).

### Afternoon — customer flow (30–60 min + wait for swap)

1. Checkout → **Polygon USDT** → refund address = your MetaMask Polygon address.
2. Copy **exact amount** and **deposit address** (memo if shown).
3. MetaMask: Polygon → send USDT to that address.
4. Wait (often ~1–3 minutes); UI should move to paid; receipt link in session.
5. Optional: merchant dashboard on the same tunnel for the “merchant tier” story.

**Amount:** respect 1Click **minimums** (often ~$1–5; your merchant `minOrder` default is **$5**).

---

## Two-tier demo in one day

| Tier | Customer | Merchant | Effort |
|------|----------|----------|--------|
| **A — Real money** | MetaMask Polygon USDT | Dashboard on same tunnel, or second browser | **Full day**, first-time mainnet deploy |
| **B — Story rehearsal** | `pnpm demo` + Simulate payment | Dashboard on localhost | **~1 hour**, no MetaMask on Polygon |

Only **A** matches your ask.

---

## Risks to budget time for

- **First live payment** — timing, `mint_lock`, USDC landing before `mint_receipt` (worker retries; watch logs).
- **1Click field quirks** — recipient must exist on mainnet; amounts are integer minor units.
- **No “Pay with MetaMask” button** — copy/send is correct; for a slicker demo you’d add WalletConnect later (not required for one day).
- **Real loss if wrong address** — use a **small** amount; double-check network (Polygon) and token (USDT).

---

## Direct answer

**Is it possible?** **Yes.** The embed snippet, cross-origin sessions, checkout, and worker polling are already aimed at this.

**Can you do it tomorrow with zero prep?** **Unlikely** without mainnet contracts, env, tunnel, merchant seeding, and fixing or bypassing **live merchant registration**.

**Can you do it in one focused day if you treat it as a mainnet smoke test?** **Yes** — that’s roughly what SPEC §9 “mainnet proof” is for, plus a static HTML merchant page instead of only CLI.

If you want to execute this next, the highest-leverage sequence is: (1) mainnet deploy checklist + real USDC id, (2) one-command `live:dev` script (web + worker + env template), (3) live merchant registration (your wallet id). I can implement (2) and (3) in the repo so your day is mostly deploy, tunnel, and MetaMask.

