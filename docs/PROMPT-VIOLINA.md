# Prompt: frontend and deployment for Zap

> Paste this into Claude Code or Codex from the repo root, or read it as a brief.
> It explains **what** to do and **why**, so you can make sensible calls when something doesn't fit.

---

## Who you are and what this is

You are taking over the **frontend polish and the server deployment** of *Zap*, a NEAR hackathon project. The deadline is **14 Nov 2026, 23:59 UTC**.

The product is a payment widget that any seller adds to their site with two lines:

```html
<script src="https://34-69-143-151.sslip.io/pay.js" defer></script>
<pay-button merchant="seller.near" amount="1" product="Tea bowl"></pay-button>
```

- **Paying:** customers pay with any coin on any chain through NEAR Intents (1Click), and the seller receives USDC.
- **Escrow:** every payment becomes a receipt NFT that holds the money in a contract until the refund window ends.
- **Refunds:** they go back to the customer's original chain and coin, with an AI refund assistant answering first.
- **Passes:** prepaid passes release to the seller period by period; cancelling refunds the rest.

**Why this matters for your work:** the judges and the demo video judge us on whether a seller can *really* get paid through a widget. Everything you do should make that path work reliably and look trustworthy.

## Read first, in this order

1. `README.md`: what works, what's simulated, the architecture.
2. `CLAUDE.md`: house rules; they override your defaults.
3. `DECISIONS.md`: why things are the way they are. Read the "Real-money pivot" section especially.
4. `docs/GO-LIVE.md`: the operator runbook for mainnet.
5. `contracts/INTERFACE.md`: only if you need to know what the contract accepts.

## Current state (verified 13 Nov 2026)

| | |
|---|---|
| Code | `main` on GitHub (`mallikaakash/Zap`) |
| Receipt contract | **Live on NEAR mainnet** at `checkout.aakash7777.near`, owned by `aakash7777.near`, $50 per-payment cap |
| Settlement worker signer | `executor.aakash7777.near` |
| Web app relayer | `relayer.aakash7777.near` |
| 1Click | Verified with a dry quote: paying $1 with Polygon USDT delivers 1.00 USDC to the contract in ~35 s |
| Server | GCP VM `34.69.143.151`, previously running the **local sandbox demo** (fake chain) |
| Public URL | `https://34-69-143-151.sslip.io` (free sslip.io name for that IP; no domain) |
| Tests | TypeScript 150 passing, contract 116 passing, local end-to-end and headless-browser walkthroughs passing |

---

## Hard rules, and why each exists

1. **Never sign, send or fund anything on NEAR mainnet, and never make a payment.** Only Aakash moves real money.
   *Why:* real funds sit in an unaudited contract, and a mistaken transaction can't be undone. You may call 1Click only for `dry: true` quotes and read-only endpoints.
2. **Never print, paste, commit or upload `.env` or anything in `~/.near-credentials`.** `.env` holds the executor and relayer private keys. Get it from Aakash over a private channel, copy it straight to the VM, and keep it at `chmod 600`.
   *Why:* those keys can mint receipts and send refunds.
3. **The live site must be HTTPS.**
   *Why:* the checkout creates the customer's receipt key with WebCrypto (`crypto.subtle`) and talks to MetaMask. Browsers only allow both on secure pages. On plain `http://<ip>` the "Continue" step of checkout fails.
4. **`PUBLIC_URL` in `.env` is the single source of the site's address.** The contract doesn't know or care about the URL.
   *Why:* it goes into checkout links, QR codes, emails and the `pay.js` snippet. Changing it later breaks snippets and links already handed out, so fix it before sellers and products are created and before filming.
5. **Don't change or redeploy the contract.**
   *Why:* redeploying costs real NEAR, the state layout can't be migrated, and every receipt and seller registration would be lost. If you think the contract needs a change, write it up instead.
6. **`pnpm install && pnpm demo` must keep working on a clean checkout with no env vars.**
   *Why:* the hackathon's first screen is an AI agent cloning the repo and following the README. It's also our test bed. Run it after any change that touches shared code.
7. **The README claims only what works.** Unfinished things go under "Planned".
   *Why:* judges check, and one false claim costs more than a missing feature.
8. **Money is integer minor units (USDC 6 dp) as strings, everywhere. Never floats.**
   *Why:* `0.1 + 0.2` bugs on real money are unacceptable. Use the helpers in `apps/web/lib/client.ts` (`toMinor`, `fromMinor`, `usd`).
9. **Commit small and often,** with clear messages, on a branch, then merge to `main`.
   *Why:* we're near a deadline, and every working state should be recoverable.

---

## Task A: run the real product on the VM (do first)

**Why first:** nothing else matters until a judge can open the HTTPS URL and see the live product.

1. **Stop the old sandbox demo** on the VM: `pkill -f scripts/demo.ts; pkill -f near-sandbox`. It serves a fake chain on port 3000.
2. **Update the code:** `git pull origin main && pnpm install` in the repo on the VM.
3. **Put `.env` in the repo root** (from Aakash, never via chat) and `chmod 600 .env`. It must contain:
   - `UC_MODE=live`, `CONFIRM_REAL_MONEY=yes`, `PUBLIC_URL=https://34-69-143-151.sslip.io`, `NEAR_NETWORK_ID=mainnet`
   - the contract, executor and relayer settings written by `pnpm deploy:mainnet`
   - optionally `RESEND=` for email and `NEARAI_API_KEY=` for the AI model
4. **HTTPS:** follow `docs/GO-LIVE.md` step 4.
   - Open TCP 80 and 443 in the GCP firewall.
   - Install Caddy, with this Caddyfile block: `34-69-143-151.sslip.io { reverse_proxy localhost:3000 }`.
5. **Run it under systemd, not just tmux**, so it survives crashes and reboots. A unit with `WorkingDirectory=<repo>`, `ExecStart=<absolute path from "which pnpm"> start`, `Restart=always`, the right `User=`, and `Environment=PATH=…` that includes the Node bin directory is enough. systemd doesn't load nvm, so relative `pnpm` and `node` won't be found. `pnpm start` builds the web app, applies the database schema without data loss, and runs the web app and settlement worker together.
6. **Back up the database daily:** for example a cron job running `cp .uc/live.db .uc/backup-$(date +%F).db`.
   *Why:* it holds the off-chain half of every order: refund chats, emails, seller dashboard links.

**Done when** all of these hold:
- `curl -s https://34-69-143-151.sslip.io/api/dev/state` returns `"mode":"live"`, `"networkId":"mainnet"` and `"receipts":"checkout.aakash7777.near"`, with `canSimulate` and `canTimeTravel` both `false`.
- The worker log shows `mode=live network=mainnet`.
- `/`, `/shop`, `/dashboard` and `/pay.js` all return 200 over HTTPS.

## Task B: a separate sandbox copy for judges

**Why:** most judges won't pay real money. They need a place to click through the *whole* story (pay, refund chat, pass, claim, transfer, cancel) with simulated swaps and a fast-forward clock. That copy must never touch the live keys or database.

1. Make a **second clone** in another folder, for example `~/uc-demo`. It must have **no `.env`**.
   *Why:* the app reads the repo-root `.env`, so a separate folder guarantees the demo can't pick up live keys.
2. Run it on another port:
   ```bash
   PORT=3001 PUBLIC_URL=https://demo.34-69-143-151.sslip.io pnpm demo
   ```
   Run it under its own systemd unit.
3. Add a Caddy block: `demo.34-69-143-151.sslip.io { reverse_proxy localhost:3001 }`.
4. `pnpm demo` prints the demo shop's dashboard link. Put that link, the demo URL and the live URL in the README's opening section.

**Known demo quirks** (state them in the README):
- Every restart resets the sandbox chain and its data.
- The sandbox clock is shared, so any visitor pressing "+10 min" moves time for everyone.

## Task C: frontend polish for the video and for judges

**Priority order** follows the video story: pay with any coin → item arrives broken → the assistant asks for a photo → it approves → money returns on the original chain → a pass changes hands → "works on any site".

The pages, all in `apps/web/app` (Next.js 16 App Router, Tailwind v4, design tokens in `globals.css`):

| Route | What it is |
|---|---|
| `/checkout/[id]` | Hosted checkout, also shown inside the button's modal iframe (`?embed=1`) |
| `/r/[id]` | Receipt page. The receipt key is in the `#k=` fragment and never leaves the browser |
| `/dashboard` | Seller signup, plus the dashboard via the private link `?m=…&t=…` |
| `/shop` | Demo shop |
| `/verify/[id]` | Public verification of a receipt |
| `/` | Landing page |
| `/dev/inbox` | Local mode only: emails the app would send |

The button itself lives in `packages/sdk` (`<pay-button>`, built to `pay.js`). `examples/seller-site/index.html` is a plain HTML shop that uses only the snippet.

**Check and fix, in this order:**

1. **Real checkout with MetaMask on mainnet:** coin search, "Use MetaMask" filling the refund address, then "Pay with MetaMask". Check that it switches to Polygon, sends the exact USDT amount, links the transaction, and that the status steps advance.
   - Watch the error states: user rejects, wrong network, no MetaMask, quote expired.
   - *Why:* this is the first thing in the video and the first thing a sceptical judge tries.
2. **The modal on a foreign site.** Open `examples/seller-site/index.html?host=https://34-69-143-151.sslip.io&merchant=<seller>&item=<product-id>&pass=<product-id>` and check:
   - the modal opens, resizes, closes on Esc, and fires `uc:paid`;
   - it fits phone widths (≤ 390 px) without horizontal scroll.
   - *Why:* "works on any site" is the core claim.
3. **Receipt page and refund chat.** The countdown, the held / paid out / refunded amounts, chat bubbles, photo attach, appeal button, and "Email me this link".
   - The copy must say plainly that the link is the key to the receipt.
4. **Seller dashboard.**
   - Signup → "your shop is ready" → the private link.
   - Products tab: add a one-time product and a pass; the "Embed" snippet and QR code.
   - Orders: the approve, decline and object buttons, and "Collect payout".
   - Notifications tab.
   - *Why:* this proves the seller side is real.
5. **Live-mode honesty.**
   - No "Simulated" badge, simulate button or sandbox clock may appear on the live site; they are already gated by mode, so confirm it.
   - The landing page's "Try it: pay $1" is a **real** $1 payment on the live site. Add a short note next to it saying so.
6. **Consistency.**
   - One accent colour; loading and empty states everywhere; no layout shift; accessible labels.
   - No hydration or console errors. Playwright is the quickest way to check (see below).

**Known limits — don't present them as features:**
- Refund-chat photos are recorded by file name only and are not uploaded or analysed.
- The live seller dashboard's login is the private link; there is no wallet sign-in yet.
- Customers who claim a receipt to a NEAR account can't act on it through our UI in live mode, because that needs the owner's wallet. Unclaimed receipts work fully through the link.

---

## How to verify your work

- `pnpm test`: TypeScript tests. `cd contracts && cargo test` if you touch Rust, which you shouldn't need to.
- `pnpm demo`, then click through the story. `pnpm demo --setup-only` followed by `npx tsx scripts/e2e.ts` (with `DATABASE_URL` pointing at `.uc/demo.db`) runs the scripted end-to-end flow.
- `pnpm deploy:mainnet` has a sandbox rehearsal mode (see the header of `scripts/deploy-mainnet.ts`). You don't need it; the contract is already deployed.
- **Live checks you may do:** page loads, `/api/dev/state`, dry quotes.
- **Live checks only Aakash does:** anything that pays. The first real $1 MetaMask payment and refund comes from Aakash before filming.

## When you report back

List, briefly:
- what you changed, with commits;
- what you verified and how;
- anything you found broken but didn't fix;
- anything that needs Aakash: keys, money, accounts or decisions.

If something in this brief turns out to be wrong, say so rather than working around it silently.
