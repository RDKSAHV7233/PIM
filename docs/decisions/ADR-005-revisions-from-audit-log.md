# ADR-005: Product Revision History Sourced From AuditLog

- Date: 2026-05-17
- Status: Accepted

## Problem

Product revision history must be retrievable per product, must include field-level before/after diffs, and must survive the approval workflow. The question is whether to store revisions in a dedicated `ProductRevision` model or to derive them from the existing global `AuditLog` table.

## Options Considered

1. Dedicated `ProductRevision` model with explicit `beforeSnapshot` / `afterSnapshot` columns and explicit relations from `Product.revisions`.
2. Derive revisions from `AuditLog` rows where `action IN ('PRODUCT_UPDATED', 'REVIEW_DECISION')`, using `metadata.changedFields` as the diff payload.
3. Hybrid: write to both AuditLog and a compact `ProductRevision` index table.

## Decision

Option 2. Revisions are sourced from `AuditLog` via `getProductRevisions()` in `apps/api/src/catalog/catalog.service.ts:452`. No dedicated `ProductRevision` model exists.

## Consequences

Positive:
- Zero duplication of data; revision history is a free byproduct of audit logging.
- Single source of truth for actor, role, timestamp, and field-level diff.
- New revision triggers are added by appending new audit `action` constants — no schema migration required.

Negative / mitigations:
- AuditLog retention policy controls revision retention. Mitigated by `docs/runbooks/audit-log-retention.md`.
- Query performance requires a composite index. Added by migration `20260517000002_auditlog_resource_action_index`: `(tenant_key, resource_id, action, created_at DESC)`.
- If we ever need cryptographic chaining or per-field rollback, we will need a dedicated `ProductRevision` model. Revisit triggers documented below.

## Revisit when

- Any customer requires > 36-month revision retention not satisfied by tier retention.
- A per-field rollback feature is requested.
- AuditLog row count for a single tenant exceeds 10M (storage and query economics shift).
- Cryptographic chaining / tamper-evident audit is implemented.
