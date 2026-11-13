---
name: near-intents
description: NEAR Intents 1Click in Zap — live adapter vs mock. Use for packages/intents-adapter, quotes, swaps, refunds.
---

# near-intents (project)

**Official:** `.agents/skills/near-intents/SKILL.md` and `rules/`.

**Code:** `packages/intents-adapter/`; factory selects mock vs live.

**Docs:** `docs/near/intents.md`

## Rules

- No testnet Intents — local mock or mainnet live
- Never invent REST paths; copy from skill rules

## Testing

Mock tests in `packages/intents-adapter/test/`; live tests skipped without credentials.
