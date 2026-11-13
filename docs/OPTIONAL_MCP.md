# Optional MCP & agent integrations

This repo enables **NEAR Docs MCP** and **NEAR blockchain MCP** in `.cursor/mcp.json`. You can add more servers as your hackathon scope grows.

## NEAR Docs (enabled)

- URL: `https://docs.near.org/mcp`
- Tools: `search_near_docs`, `query_docs_filesystem_near_docs`, `submit_feedback`
- Read-only; safe for all environments.

## NEAR blockchain MCP (enabled by default)

- Package: `@nearai/near-mcp` (pinned **0.0.35** in `.cursor/mcp.json`)
- Runs **locally**; may store account keys on disk.
- Remove the `near-mcp` block from `.cursor/mcp.json` if you only want documentation tools.

Docs: https://github.com/nearai/near-mcp

## near-hydra (Chain Signatures + Intents)

All-in-one CLI and MCP for multi-chain flows — useful for Intents-heavy hackathon projects.

- Repo: https://github.com/near/near-hydra
- Add to `.cursor/mcp.json` per that repo’s README when you need cross-chain agent tools.

## NEAR Intents API

No MCP required; use the `near-intents` skill under `.agents/skills/near-intents/` and https://docs.near-intents.org/

## NEAR AI Cloud

For private inference / agent hosting, follow `.agents/skills/near-ai-cloud/` and https://docs.near.ai/
