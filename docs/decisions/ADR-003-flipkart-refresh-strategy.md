# ADR-003: Flipkart Token Refresh Strategy

- Date: 2026-03-04
- Status: Accepted

## Problem
Flipkart credentials must remain valid for publish/export workflows without manual re-auth for every request.

## Options Considered
1. Refresh token on every request.
2. Scheduled heartbeat/refresh before expiry with fallback refresh on demand.

## Decision
Use scheduled credential heartbeat with expiry detection, plus on-demand refresh in token resolution path.

## Consequences
- Lower runtime auth failures during worker execution.
- Requires clear alerting when refresh fails repeatedly.
