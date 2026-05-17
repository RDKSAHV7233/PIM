# ADR-006: `allowFailure=true` Gate Steps Carry a Sunset

- Date: 2026-05-17
- Status: Accepted

## Problem

`scripts/run-increment-gates.cjs` exposes an `allowFailure: true` flag on gate steps. Currently used by the `Integration: connector idempotency` step pending INC-10 Flipkart publish loop closure. Without convention, `allowFailure` becomes a permanent escape hatch that hides regressions and erodes gate value over time.

## Options Considered

1. Forbid `allowFailure: true` entirely. Failing tests must be fixed or removed.
2. Allow it indefinitely. Engineering trusts itself to clean up.
3. Allow it, but require a documented sunset.

## Decision

Option 3. Every use of `allowFailure: true` must include a comment block immediately above it stating:
- The reason the step is known-failing.
- The increment / story ID that will close it.
- The expected sunset date (target completion).

PR reviewers must reject any introduction of `allowFailure: true` that lacks this metadata.

## Consequences

Positive:
- Honest gating that surfaces known failures continues to be possible.
- Each escape hatch has a deadline and an owner.

Negative / mitigations:
- Convention not yet enforced by tooling. Manual review discipline required. A future linter check on `run-increment-gates.cjs` could automate this.

## Current outstanding `allowFailure` items

| Step | Reason | Closure story | Sunset target |
|---|---|---|---|
| Integration: connector idempotency | Flipkart publish loop incomplete | INC-10 ST-FK-RUNTIME-003/004/005 | 2026-06-07 |

When the table is empty, this ADR can be revisited.
