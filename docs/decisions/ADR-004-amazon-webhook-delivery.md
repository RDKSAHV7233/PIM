# ADR-004: Amazon SP-API Notification Delivery Mechanism

- Date: 2026-03-04
- Status: Pending (Research pre-condition)

## Problem
P5-S5 webhook implementation depends on Amazon notification transport (direct HTTP vs SQS/EventBridge).

## Options Considered
1. Direct HTTP receiver controller.
2. SQS consumer worker.
3. EventBridge consumer path.

## Decision
Pending completion of C-03 research and sandbox verification.

## Consequences
- P5-S5 planning is blocked until delivery mechanism is confirmed.
- If SQS is confirmed, webhook ingestion must be implemented as queue consumer, not direct controller.
- Environment and infra requirements depend on final transport decision.
