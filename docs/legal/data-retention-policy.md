# Vexa PIM Data Retention Policy

- Document owner: Product Ops + Compliance + CTO
- Status: Active operational baseline
- Last updated: 2026-09-03

## 1. Purpose
This policy defines the baseline retention and deletion posture for data processed in Vexa PIM.

The objective is to:
- retain enough information for security, auditability, support, and legal compliance;
- avoid keeping data longer than operationally justified; and
- keep non-production artifacts under tighter control.

## 2. Principles
- Tenant isolation applies to retention and purge operations.
- Retention may be extended for legal hold, incident response, fraud review, or contractual obligations.
- Production data and test data are handled differently.
- Where automated deletion is not yet implemented, manual operational handling must be recorded.

## 3. Retention Baseline

| Data category | Examples | Retention baseline | Notes |
|---|---|---|---|
| Authentication records | login attempts, lock state, revocation metadata | 90 days for transient security state; longer where captured in audit logs | In-memory or Redis lock state is operational, not archival |
| Audit logs | role changes, connector access changes, privacy actions, password set events | 365 days minimum | Extend for investigations or legal hold |
| Consent records | account consent events | 365 days minimum after last active use, or longer if required by law | Needed for privacy/compliance traceability |
| Privacy request records | account export and deletion request metadata | 365 days minimum after request closure | Export fulfillment may be manual during controlled rollout |
| Product and taxonomy data | products, variants, categories, attributes | retained for active tenant lifetime | Deleted or exported per customer offboarding or purge request |
| Connector job metadata | export jobs, submissions, retries, dead-letter metadata | 180 days baseline | Longer retention may be required for dispute handling |
| Payload snapshots | connector request/response payload snapshots | 90 days baseline unless shorter retention is configured | Sensitive fields must be redacted where required |
| Credential material | encrypted connector credentials, API keys, password hashes | retained while active; remove on revocation/offboarding unless legal hold applies | Never store plain-text credentials |
| Notifications and operational summaries | user notifications, dashboard summaries, usage snapshots | 90 days baseline unless needed for billing or trend evidence | Cached/derived records may expire sooner |
| Test data | smoke, benchmark, seeded fixtures, staging-only artifacts | purge as soon as no longer needed | Use the test-data purge workflow |

## 4. Test Data Policy
Test and smoke artifacts must not accumulate indefinitely in seller-facing environments.

Operational rules:
- hide test data by default in seller-facing UI;
- use tenant-scoped purge tooling for non-production cleanup;
- run dry-run before purge execution; and
- record purge evidence in execution docs when used for release hygiene.

Reference: `docs/runbooks/test-data-governance.md`

## 5. Deletion Triggers
Deletion or purge may be triggered by:
- customer offboarding;
- approved deletion request;
- test-data cleanup;
- credential or API-key revocation;
- contract termination; or
- internal retention-window expiry.

## 6. Manual Controls
Where automated deletion or fulfillment is not yet implemented:
- the request must still be recorded in-system;
- the handling owner must be clear;
- the user-facing surface must not promise automatic fulfillment; and
- completion should be recorded once fulfilled manually.

## 7. Legal Hold and Exceptions
The operator may suspend deletion where reasonably required for:
- litigation hold;
- fraud or abuse investigation;
- regulatory inquiry;
- incident response; or
- contract enforcement.

Any retention exception should be documented with scope and owner.

## 8. Technical Implementation Reality (2026-09-03)

This section documents the actual code-level mechanisms that implement or
constrain the retention baselines above. Gaps between policy and implementation
are flagged.

### 8.1 Product Soft-Delete

Products use a `deletedAt` timestamp column. The Prisma soft-delete middleware
(`apps/api/src/common/prisma-soft-delete.middleware.ts`) auto-injects
`deletedAt: null` into all Product read operations (findFirst, findMany, count,
aggregate, groupBy, findUnique). A `withSoftDeleteBypass()` escape hatch
exists for admin recovery paths. Hard-delete (purge) requires the product to
be soft-deleted first (`catalog.service.ts`).

**Gap:** No automated purge of soft-deleted products after a retention window.
Soft-deleted products remain in the database indefinitely until operator
intervention.

### 8.2 Account Deletion

The `AccountDeletionWorkerService` (`apps/api/src/auth/account-deletion-worker.service.ts`)
implements a queue-based deletion pipeline:
- 24-hour grace period (`DELETION_GRACE_PERIOD_MS`) between request and
  execution.
- On execution: deletes MFA enrollments and auth identities in a transaction,
  marks the deletion request as `completed`.
- On startup: sweeps overdue `scheduled` deletion requests (up to 50) and
  re-enqueues them.
- Failure: marks the request as `failed` and throws for retry.
- All deletions are audit-logged (`account.deletion_executed`).

**Gap:** The deletion scope covers auth artifacts (MFA, auth identities) but
does not cascade to product data, connector credentials, or submissions. Full
tenant-data purge for offboarding is a manual operational procedure.

### 8.3 Account Export

The `AuthExportStorageService` (`apps/api/src/auth/auth-export-storage.service.ts`)
stores account export artifacts in either:
- **Cloudflare R2** (production): `exports/{tenantId}/{jobId}.{json|csv}` in
  `R2_PRIVATE_BUCKET_NAME`. Download URLs are signed with 15-minute expiry.
- **Local filesystem** (dev/fallback): `storage/account-exports/{tenantId}/`.

Export storage mode is determined by `ACCOUNT_EXPORT_STORAGE_MODE` env var
(`auto` | `filesystem` | `object_storage`). The service includes health probes
for storage verification.

**Gap:** No automated expiry of export artifacts in R2. Files persist
indefinitely unless manually deleted.

### 8.4 Database Backups

Per `docs/runbooks/backup-restore.md`:
- **Method:** `pg_dump` → gzip → Cloudflare R2 (`R2_PRIVATE_BUCKET_NAME/backups/`).
- **Frequency:** Daily at 02:00 UTC (`.github/workflows/backup-r2-daily.yml`).
- **Retention:** 30 days with a 7-backup floor (pruning script keeps at least 7
  most recent regardless of age).
- **RPO:** Up to 24 hours (no PITR — self-hosted Postgres on Railway).
- **RTO:** 4 hours target (manual restore + smoke test).
- **Verification:** Non-zero HeadObject check after upload.

**Gap:** No restore drill has been executed. R2 secrets not yet added to GitHub
Actions as of last check. These are named GA blockers.

### 8.5 Audit Logs

Per `docs/runbooks/audit-log-retention.md`:
- Audit logs serve as the system of record for product revision history (ADR-013).
- Retention tiers: Local 30d, Staging 90d, Pilot 24mo, Growth 36mo,
  Enterprise 60mo.
- **No automated purge is running.** Purge spec exists but
  `scripts/purge-audit-log.cjs` is not yet implemented.
- Audit logs accumulate indefinitely in all environments.

### 8.6 Media / Images

Per backup-restore runbook:
- Media stored in Cloudflare R2 (`media/` prefix).
- Retention: indefinite (pay-as-you-go).
- No expiry policy on unused media.

### 8.7 Redis

- Railway-managed volume with RDB snapshots (`--save 60 1`).
- Treated as a cache layer — rebuilt on reconnect.
- No retention policy needed (operational, not archival).

### 8.8 Connector Credentials

- Encrypted with AES-256-GCM (versioned keys, `enc::v{n}:` prefix).
- Retained while active; removed on connector uninstall/revocation.
- Credential material is never stored in plain text.
- Rotation support via versioned encryption keys.

### 8.9 Connector Job Metadata and Payload Snapshots

- `ConnectorSubmission` model is tenant-scoped.
- Payload snapshots stored alongside submissions.
- **Gap:** No automated purge after the 180-day or 90-day baseline. Job
  metadata and payloads accumulate indefinitely.

### 8.10 Summary of Gaps

| Area | Policy | Reality | Remediation |
| --- | --- | --- | --- |
| Soft-deleted products | Retained for active tenant lifetime | Retained indefinitely | Implement admin purge tooling |
| Account deletion scope | Full data removal | Auth artifacts only | Extend to catalog/connector data |
| Export artifact expiry | Not specified | Indefinite in R2 | Add R2 lifecycle rule |
| Backup restore drill | Required before SLA | Not executed | Named GA blocker |
| Audit log purge | Tier-based retention | No purge running | Implement purge script |
| Connector job metadata | 180-day baseline | Indefinite | Add scheduled purge |
| Payload snapshots | 90-day baseline | Indefinite | Add scheduled purge |

## 9. Review Cycle
This policy should be reviewed:
- at least once per quarter during controlled rollout; and
- whenever new privacy workflows, storage classes, or legal obligations are introduced.
