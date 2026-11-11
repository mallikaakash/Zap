# How to hand this to Claude Code

## 1. One-time setup (you)
1. Create a **public** GitHub repo, clone it, and put `SPEC.md` and `CLAUDE.md` in the root.
2. Install: Node 20 + pnpm, Rust + `cargo-near` + `near-cli-rs`, Docker (for the WooCommerce test store).
3. Open the repo folder in a terminal and run `claude`.

## 2. First prompt (planning only)
Paste this:

```
Read CLAUDE.md and SPEC.md fully. Don't write code yet.
Enter plan mode and give me:
1) the exact tech choices and versions you'll use for each folder,
2) anything in the spec you think is wrong, risky or unclear (especially the receipt
   contract and how the settlement worker detects payments),
3) a step list for blocks A–D of the sprint checklist.
Ask me only what you truly need from me (accounts, keys, decisions).
```

Review its answers, correct anything, then:

## 3. Build prompts (one block at a time)

```
Implement block A of SPEC.md §12. When done: run pnpm test and pnpm demo, show me the
output, tick the boxes in SPEC.md, and commit.
```
Then the same for B, C, D… Check the demo yourself after C and after D.

Useful extras:
- After block C: `Run the full flow in local mode: create a session, simulate payment, wait for the receipt, request a refund, and show me the contract events.`
- Parallel work once C is done: `Use subagents to build the WooCommerce plugin and the MCP server in parallel, following SPEC.md §10. Each must have its own README section and tests.`
- Before submitting: `Clone this repo into a fresh temp folder and follow README.md exactly as a judge would. Fix everything that fails, then repeat until it runs clean.`

## 4. Things only you do
- Create NEAR testnet accounts (contract, merchant, customer) when Claude asks.
- NEAR Builders profile → NEAR AI key (for the AI refund agent).
- Vercel + Neon accounts for the hosted demo.
- (Optional) Mainnet proof: fund MetaMask with ~$2 Polygon USDT + a few cents POL, a little NEAR in your proof account, then run `UC_MODE=live CONFIRM_REAL_MONEY=yes MAX_USD=2 pnpm proof:mainnet` and send from MetaMask when it prints the deposit address.
- Record the video, post on X, submit the form.
