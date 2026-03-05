# ADR-002: Primary Datastore

Status: Accepted
Date: 2026-02-25

## Context
Catalog, compliance, and mapping need consistency and relational integrity.

## Decision
Use PostgreSQL as the primary transactional datastore.

## Consequences
- Strong ACID guarantees for core entities.
- Requires careful indexing and query tuning for high-volume bulk operations.
