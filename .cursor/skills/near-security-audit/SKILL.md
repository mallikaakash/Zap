---
name: near-security-audit
description: Pre-deploy NEAR contract security review. Wraps official near-contract-audit skill for Zap escrow and refund logic.
---

# near-security-audit

**Official:** `.agents/skills/near-contract-audit/SKILL.md` + `references/*-severity.md`

## Product focus areas

- Escrow accounting (USDC balance vs assignments)
- Receipt-key signature replay and nonce handling
- Refund caps, pause, AI veto windows (`contracts/INTERFACE.md`)
- Executor trust boundaries (`docs/near/security.md`)

## When to run

Before mainnet deploy, after material contract changes, when adding new external calls.

## Output

Structured findings by severity; no rubber-stamp without reading changed Rust.
