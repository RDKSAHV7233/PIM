# Security And Privacy Evidence Pack

Last reviewed: 2026-09-03

Status: active working pack - doc corrections applied 2026-09-03

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
| Incident response | `docs/runbooks/incident-response.md` | Fill contacts and escalation owner |

## Evidence Checklist

| Control | Evidence required | Owner | Status |
| --- | --- | --- | --- |
| Auth/login | Current login, reset, lockout, MFA/step-up, signup-gate evidence | Security / QA | Needed |
| RBAC | All 8 app roles and admin-boundary roles verified in UI/API | Security / QA | Needed |
| Tenant isolation | Cross-tenant deny/404 behavior verified with real isolated tenants | CTO / QA | Needed |
| Connector credentials | Secrets encrypted, redacted in audit/logs, never exposed in UI/API | Security / Connector team | Needed |
| Audit logs | Sensitive actions captured; sensitive values redacted | Security / QA | Needed |
| API keys/webhooks | Plan/role gating and revocation verified | Security / QA | Needed |
| Account export/delete | Customer data export and deletion path verified | Privacy / QA | Needed |
| Test data governance | Test artifacts hidden/purged from seller-facing flows | QA / Ops | Needed |
| Backup/restore | Non-zero backup and restore drill measured | SRE / Ops | Needed |
| Incident response | On-call contacts, escalation, severity, and customer comms ready | Ops / Support | Needed |
| Public claim privacy review | Every public data/security claim approved | Privacy / Legal / Marketing | Blocked |

## Approval Rule

Security/privacy signoff requires current evidence, not historical plan text.
Evidence can be a test result, browser capture, CI run, restricted operational
record, or signed review note. If evidence contains secrets, customer data, or
restricted commercial/legal information, store only a reference ID in the repo.
