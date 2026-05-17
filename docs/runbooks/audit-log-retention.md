# AuditLog Retention Policy

**Status:** Draft for review. Not yet automated.
**Owner:** CTO (policy), DevOps (execution).
**Authority:** ADR-013 (AuditLog-sourced revision history).
**Last reviewed:** 2026-05-17.

---

## Why this policy matters

The `AuditLog` table in `packages/db/prisma/schema.prisma` is the system of record for two things:

1. **Operational audit trail** — actor, role, resource, action, timestamp, metadata for every catalog, workflow, connector, webhook, billing-governance, and access-policy operation. Used by `/admin/audit` and by `audit-explorer` exports.
2. **Product revision history** — `getProductRevisions()` in `apps/api/src/catalog/catalog.service.ts:452` queries `AuditLog` WHERE `action IN ('PRODUCT_UPDATED', 'REVIEW_DECISION')` and reconstructs revision items from the per-row `metadata.changedFields` payload.
3. **Product activity timeline** — `getProductActivity()` in `apps/api/src/catalog/catalog.service.ts:734` queries `AuditLog` WHERE `resourceId = product.id`.

Because revisions and activity are AuditLog-sourced rather than stored in a dedicated `ProductRevision` model (ADR-013), the retention policy on `AuditLog` is the retention policy on revision history.

**Implication for ops:** any deletion or aggressive purge of `AuditLog` rows destroys product revision history and breaks the activity timeline UI. This document defines how to safely manage growth.

---

## Retention by tier

| Tier | AuditLog retention | Justification |
|---|---|---|
| **Local / dev** | 30 days | Local development noise; no customer impact. |
| **Staging** | 90 days | Long enough to verify gate evidence; short enough to keep test data hygiene. |
| **Pilot (paid)** | 24 months | Pilot contracts state "approval review with revision evidence". 24 months covers two annual contract cycles. |
| **Growth / Scale** | 36 months | SMB and mid-market customers; matches typical SOX-adjacent expectations. |
| **Enterprise** | 60 months | Required for SOC2 / ISO27001 readiness. Will be revisited when enterprise readiness ships. |

## Retention by record class

Within `AuditLog`, not all rows are equivalent. The following classes deserve different treatment when (and only when) a purge is implemented:

| Action prefix | Class | Recommended retention |
|---|---|---|
| `PRODUCT_*`, `REVIEW_*`, `STATUS_TRANSITION`, `APPROVAL_COMMENT_*` | Revision-bearing | Tier maximum (do not truncate before retention deadline). |
| `LOGIN`, `LOGOUT`, `PASSWORD_*`, `MFA_*`, `STEP_UP_*` | Auth audit | Tier maximum minus 6 months acceptable. |
| `EXPORT_JOB_*`, `CONNECTOR_*`, `SUBMISSION_*` | Connector ops | Tier maximum. |
| `READ_*` | Read access traces (if enabled) | 90 days regardless of tier. |
| Everything else | General operations | Tier maximum minus 12 months acceptable. |

The default purge implementation should treat all rows uniformly at tier maximum; per-class differentiation is a future enhancement.

---

## How purging is implemented (when enabled)

**Important:** As of 2026-05-17, no automated purge is running. Manual invocation only.

Recommended approach when automation is approved:

1. A scheduled job (GitHub Actions cron, Railway scheduled task, or pg_cron) runs nightly.
2. The job calls `node scripts/purge-audit-log.cjs --tenant <key> --retention-days N --dry-run` first to count affected rows.
3. If row count is within expected bounds (no anomalies), the job re-runs without `--dry-run`.
4. The purge issues `DELETE FROM audit_logs WHERE tenant_key = $1 AND created_at < NOW() - INTERVAL '$2 days'` with `LIMIT 10000` batches to avoid long-running locks.
5. Each batch logs `tenant_key`, `rows_deleted`, `oldest_remaining_created_at`.
6. The purge is **always tenant-scoped**. There is no global purge.

The implementing script (`scripts/purge-audit-log.cjs`) must:
- Accept `--tenant`, `--retention-days`, `--dry-run`, `--batch-size` flags.
- Refuse to run without `--tenant` (no implicit "all tenants" mode).
- Refuse to run with retention < 30 days unless `--allow-aggressive` is set.
- Emit a final JSON summary suitable for ingestion by the gate signoff pipeline.
- Record a meta-audit entry: an `AUDIT_LOG_PURGED` row in `AuditLog` itself with metadata `{ tenant, retentionDays, rowsDeleted, oldestRemainingCreatedAt }`. The meta-audit row is exempt from purge.

---

## Operational safeguards

1. **Index dependency.** Purge performance assumes the composite index `idx_audit_logs_tenant_resource_action_created` (added in migration `20260517000002_auditlog_resource_action_index`) plus the existing `idx_audit_logs_created_at`. Verify both exist before running.

2. **Backup before first purge per tenant.** The first time a purge runs against a tenant, take a logical dump of that tenant's `audit_logs` rows to cold storage. Subsequent purges within the same retention contract do not need this.

3. **Customer notification.** Pilot and paid customers must be notified in writing 30 days before the first purge that affects their tenant. The notification must reference the retention tier in their contract.

4. **Hold flag for legal / dispute scenarios.** If a customer or legal hold requires audit data beyond the retention window, set `tenant_audit_retention_hold` (future migration) to `true` for that tenant. Purges must check this flag and skip held tenants.

5. **Revision impact disclosure.** Sales materials and the user guide must disclose: "Product revision history is retained for the duration of your audit retention tier." This phrase is binding.

---

## When this policy changes

The policy changes when:

- A new contract tier is introduced or an existing tier is renegotiated.
- A dedicated `ProductRevision` model is introduced (revisit ADR-013).
- Cryptographic chain / tamper-evident audit is implemented — that changes the storage shape and retention math.
- A legal or regulatory requirement adds a minimum-retention floor.

Any change requires CTO sign-off documented in a new ADR.

---

## Open items (not yet executed)

- [ ] Implement `scripts/purge-audit-log.cjs` per the specification above.
- [ ] Schedule per-environment purges (local: monthly manual; staging: weekly auto; production: nightly per-tenant).
- [ ] Add a meta-audit `AUDIT_LOG_PURGED` action constant to the API.
- [ ] Add a `tenant_audit_retention_hold` column or per-tenant override table.
- [ ] Add a Grafana / observability panel for `audit_logs` row count per tenant and growth rate.

These items are tracked in the broader engineering backlog. None are blockers for the controlled paid pilot release.
