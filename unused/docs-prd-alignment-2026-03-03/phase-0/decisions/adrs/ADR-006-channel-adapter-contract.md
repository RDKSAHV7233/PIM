# ADR-006: Channel Adapter Contract

Status: Accepted
Date: 2026-02-25

## Context
Marketplace schema drift is frequent and channel-specific logic must remain isolated.

## Decision
Use a versioned adapter contract and mapping packs per channel.

## Consequences
- Safer updates when marketplace schemas change.
- Requires contract tests and release discipline per adapter.
