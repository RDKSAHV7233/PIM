# Security And Privacy Evidence Pack

Last reviewed: 2026-09-03

Status: active working pack — code-derived evidence populated 2026-09-03

This pack defines the evidence needed before CTO, Security, Privacy, or Legal
can approve broader customer use. It does not replace formal security testing.

## Existing Documents To Check

| Area | Existing docs | Current preparation need |
| --- | --- | --- |
| Threat model | `docs/architecture/security-threat-model.md` | Refresh after connector or auth changes |
| RBAC | `docs/security/rbac-permissions-matrix.md`, `docs/test-plan/rbac-matrix.json` | Confirm parity with current decorators and browser role evidence |
| Tenant isolation | `docs/decisions/ADR-001-tenant-scoping.md`, current-state summary, tests | Add current cross-tenant evidence and denial paths |
| Credential handling | `docs/runbooks/credential-key-rotation.md`, connector docs | Confirm encryption, redaction, rotation, and no credential exposure |
| Privacy/data flows | `marketing/privacy/data-governance.json`, legal privacy docs | Technical wording refreshed; privacy/security/legal approvals still blocked |
| Data retention/export/delete | legal docs and runbooks | Privacy FAQ route/backup wording refreshed; capture current retention, export, deletion, and backup behavior |
| Vulnerability posture | `docs/security/vapt-summary.md`, `docs/security/soc2-readiness.md` | Current scan/review dates refreshed; external VAPT still needed |
| Incident response | `docs/runbooks/incident-response.md` | Contacts filled (sole operator CTO) |

## Evidence Checklist

| Control | Evidence required | Owner | Status | Code-derived evidence (2026-09-03) |
| --- | --- | --- | --- | --- |
| Auth/login | Current login, reset, lockout, MFA/step-up, signup-gate evidence | Security / QA | Partial | `auth.controller.ts` (8 `@Roles` decorators), `mfa.controller.ts` (5 decorators), `step-up.guard.ts`, `jwt-auth.guard.ts` with tenant-key validation. MFA enrollment/backup-code models tenant-scoped. Signup route exists but feature-flagged. Browser verification needed for lockout and reset flows. |
| RBAC | All 8 app roles and admin-boundary roles verified in UI/API | Security / QA | Partial | 198 `@Roles` decorator usages across 29 controllers. `rbac.guard.ts` enforces tenant-scoped role checks. 8 app roles + 3 admin-boundary roles declared in code. `rbac-matrix.json` test fixture exists. Error Authority browser verification (2026-08-21) confirmed 3-role denial. Live browser role sweep still needed for all 8 roles. |
| Tenant isolation | Cross-tenant deny/404 behavior verified with real isolated tenants | CTO / QA | Partial | **Prisma tenant-scope extension** (`prisma/extensions/tenant-scope.ts`) auto-injects `tenantKey` into every query for **42 tenant-scoped models** (including Product, Variant, ConnectorInstallation, ConnectorCredential, AuditLog, ApiAccessKey, etc.). SEC-001 remediation added drift-guard test (`tenant-scope.spec.ts`) that fails CI if any model with a `tenantKey` column is not in the scoped set. 1 model intentionally excluded (`WorkspaceDirectory` — cross-tenant directory, documented reason). `tenant-throttler.guard.ts` enforces per-tenant rate limits. Cross-tenant denial testing with a real second tenant still needed. |
| Connector credentials | Secrets encrypted, redacted in audit/logs, never exposed in UI/API | Security / Connector team | Partial | **AES-256-GCM encryption** with 12-byte IV, 16-byte auth tag, versioned keys (`CREDENTIAL_ENCRYPTION_KEY_V{n}`), `enc::v{n}:` prefix format (`credential-encryption.util.ts`). `credential-encryption.service.ts` wraps encrypt/decrypt for connector installer. 20 files reference encrypt/decrypt operations across all connectors (Shopify, WooCommerce, Flipkart, Amazon, Myntra). `connector-installer.controller.ts` redacts credentials in API responses. 21 files contain redact/sanitize/mask patterns. `error-redaction.ts` strips sensitive values from error payloads. Spec coverage: `credential-encryption.util.spec.ts`, `connector-installer.service.spec.ts`. |
| Audit logs | Sensitive actions captured; sensitive values redacted | Security / QA | Partial | **Global `AuditLogInterceptor`** (`common/audit/audit-log.interceptor.ts`) intercepts all non-GET requests, extracts resource IDs from params/response, and delegates to `AuditService`. `AuditLog` model is tenant-scoped. `audit.controller.ts` (3 `@Roles` decorators) provides admin-only query/filter. `audit.service.spec.ts` verifies capture behavior. 14 files reference audit log operations. Sensitive value redaction in audit payloads not independently verified. |
| API keys/webhooks | Plan/role gating and revocation verified | Security / QA | Partial | `api-keys.controller.ts` has `@Roles` decorator and plan-gating. `ApiAccessKey` model is tenant-scoped. `outbound-webhooks.controller.ts` has role guard and credential redaction. `OutboundWebhookEndpoint` and `OutboundWebhookDelivery` models are tenant-scoped. Integration test exists: `api-keys.test.cjs`. Browser/live revocation verification still needed. |
| Account export/delete | Customer data export and deletion path verified | Privacy / QA | Partial | `delete-account.dto.ts` defines deletion request structure. `auth.controller.ts` exposes delete endpoint. `AccountExportRequest` and `AccountDeletionRequest` models are tenant-scoped. `prisma-soft-delete.middleware.ts` implements soft-delete. Actual delete/export workflow end-to-end verification still needed. |
| Test data governance | Test artifacts hidden/purged from seller-facing flows | QA / Ops | Needed | No code-level evidence available. Requires operational verification. |
| Backup/restore | Non-zero backup and restore drill measured | SRE / Ops | Needed | Backup config documented in runbooks (daily `pg_dump` to R2). No drill evidence exists. |
| Incident response | On-call contacts, escalation, severity, and customer comms ready | Ops / Support | Done | On-call contacts filled 2026-09-03 (sole operator CTO). Incident response runbook complete with severity matrix, triage checklist, and customer comms templates. Secondary on-call not yet assigned. |
| Public claim privacy review | Every public data/security claim approved | Privacy / Legal / Marketing | Blocked | Public claims remain blocked. Claim audit refreshed 2026-09-03. No public claims approved for publication. |

## Controlled-Pilot Accepted Posture

For the CTO/PO-approved controlled pilot (up to 2 ENTERPRISE tenants,
operator-supervised), the following security posture is accepted:

- **RBAC:** 198 decorator-enforced role checks across 29 controllers; 3-role
  denial browser-verified. Full 8-role browser sweep deferred.
- **Tenant isolation:** 42-model Prisma extension with CI drift guard. No
  second-tenant cross-denial test yet — accepted risk for single-tenant pilot.
- **Credential encryption:** AES-256-GCM with versioned key rotation,
  redaction in API responses and error payloads.
- **Audit:** Global interceptor captures all mutations. Admin-only query
  access.
- **Incident response:** sole operator on-call, no secondary.

Items explicitly NOT accepted for GA:
- External VAPT
- Cross-tenant denial test with real isolated second tenant
- Full 8-role browser verification sweep
- Account export/delete end-to-end verification
- Backup restore drill with measured RPO/RTO
- Public claim privacy review

## Approval Rule

Security/privacy signoff requires current evidence, not historical plan text.
Evidence can be a test result, browser capture, CI run, restricted operational
record, or signed review note. If evidence contains secrets, customer data, or
restricted commercial/legal information, store only a reference ID in the repo.
