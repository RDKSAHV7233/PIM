# ADR-003: Background Job Processing

Status: Accepted
Date: 2026-02-25

## Context
Bulk imports and heavy validations should not block user interactions.

## Decision
Use queue-backed asynchronous workers for import processing and validation tasks.

## Consequences
- Better resilience for large jobs.
- Requires observability and retry policies to prevent silent failures.
