---
title: SOC 2 Type I Readiness Roadmap
audience: internal-eng
status: active
last_updated: 2026-05-25
owner: Engineering + Product
---

Use this document to understand Vexa PIM's current position against SOC 2 Type I criteria and what remains before an auditor assessment.

SOC 2 Type I evaluates whether controls are suitably designed at a point in time. Type II requires evidence of operating effectiveness over a period (typically 6 months). This roadmap targets Type I first.

---

## 1. Trust Service Criteria Overview

| Criterion | Abbrev | In scope for Type I |
|-----------|--------|---------------------|
| Security | CC | Yes (required) |
| Availability | A | Yes |
| Confidentiality | C | Yes |
| Processing Integrity | PI | Yes |
| Privacy | P | Yes |

---

## 2. Security (CC) — Common Criteria

### CC1: Control Environment

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Documented security policy | Partial — ADRs + runbooks exist; no formal InfoSec policy | Write `docs/security/security-policy.md` | Low |
| Roles and responsibilities documented | RBAC matrix at `docs/security/rbac-permissions-matrix.md` | Complete | — |
| Background check policy | None | PO/Legal to define | Medium |

### CC2: Communication and Information

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Privacy policy published | Yes — `docs/legal/privacy-policy.md` | Complete | — |
| Incident response procedure | Yes — `docs/runbooks/incident-response.md` | Complete | — |
| AUP published | Skeleton — `docs/legal/acceptable-use-policy.md` | Legal to complete | Low |

### CC3: Risk Assessment

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Formal risk assessment | None | Document top 10 risks with likelihood/impact | Medium |
| Threat model for API | Informal (ADRs reference OWASP) | Write formal threat model | Medium |

### CC4: Monitoring

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Error tracking | Sentry (activation-gated) | Activate in production | Low |
| Metrics + alerting | Prometheus + Grafana | Configure alert thresholds | Low |
| Audit log coverage | Comprehensive — all mutations logged | Complete | — |
| Log retention 365 days | Policy defined | Automated enforcement needed | Medium |

### CC5: Logical Access Controls

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Authentication required for all endpoints | Yes — RBAC guard on all routes | Complete | — |
| MFA available | Yes — TOTP enrollment | Complete | — |
| MFA required for admin | Policy exists (`TenantAuthPolicy.mfaRequired`) | Not enforced by default for all admins | Medium |
| Session timeout | Configurable per workspace | Complete | — |
| Account lockout on failed logins | Yes — brute force protection | Complete | — |
| Least-privilege access | 8-role hierarchy; viewer default | Complete | — |
| API key expiry and revocation | Yes — `ApiAccessKey.expiresAt`, `revokedAt` | Complete | — |
| Credential encryption | AES-256 for connector credentials | Complete | — |
| Password hashing | bcrypt cost 12 | Complete | — |

### CC6: System Operations

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Change management | GitHub PRs; no formal CAB | Define lightweight CAB for production changes | Low |
| Pre-production testing | Integration test suite (257 files) | Complete | — |
| Deployment controls | Railway preDeployCommand; migration gate | Complete | — |
| Incident response runbook | Yes | Complete | — |
| Vulnerability management | None formal | Define patch management SLA; subscribe to security advisories | Medium |

### CC7: Change Management

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Code review required | GitHub branch protection (enforced by process) | Formalise as written policy | Low |
| Staging environment | Railway staging service | Complete | — |
| Rollback procedure documented | Yes — `docs/runbooks/production-deploy.md` | Complete | — |

---

## 3. Availability (A)

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Uptime monitoring | Railway health check | Integrate with external uptime monitor (UptimeRobot / Better Uptime) | Low |
| RPO/RTO defined | 24h RPO, 4h RTO — `docs/legal/sla.md` | Legal to finalise SLA | Low |
| Backup and restore procedure | Yes — `docs/runbooks/backup-restore.md` | Complete | — |
| DR runbook | Yes — `docs/runbooks/disaster-recovery.md` | Complete | — |
| Capacity planning | Informal | Document scaling triggers (section 2 of `docs/architecture/scaling-guide.md`) | Low |

---

## 4. Confidentiality (C)

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Data classification policy | Informal (ADRs reference data sensitivity) | Write formal data classification | Medium |
| Encryption in transit | TLS enforced by Railway + Cloudflare | Complete | — |
| Encryption at rest | Neon (PostgreSQL with TDE); R2 (AES-256) | Complete | — |
| Connector credential encryption | AES-256 at application layer | Complete | — |
| Secrets not in logs | Enforced by code — never logged | Complete | — |
| NDA for employee/contractor access | None formal | PO/Legal to define | Medium |

---

## 5. Processing Integrity (PI)

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Input validation | `class-validator` DTOs on all inputs | Complete | — |
| Output validation | Not formally defined | Low priority for Type I | Low |
| Error handling | Global exception filter; no raw stack traces in responses | Complete | — |
| Queue durability | BullMQ persistent jobs; dead-letter queues | Complete | — |
| Idempotency | Import rows + connector submissions are idempotent | Complete | — |
| Audit trail | `AuditLog` table; actor + resource + action on every mutation | Complete | — |

---

## 6. Privacy (P)

| Control | Current state | Gap | Effort |
|---------|--------------|-----|--------|
| Privacy policy | Yes | Complete | — |
| Consent management | `AccountConsentEvent` | Complete | — |
| Right to erasure | Manual process; `AccountDeletionRequest` | Automate deletion pipeline | Medium |
| Right of access | Account export API | Complete | — |
| Data minimisation | Only necessary fields collected | Complete | — |
| DPDP Act mapping | `docs/legal/dpdp-compliance.md` | Complete | — |
| Data localisation statement | Not yet written | Legal to write | Medium |

---

## 7. Estimated Effort to Type I Readiness

| Category | Gaps | Estimated effort |
|----------|------|-----------------|
| Policies (InfoSec policy, data classification, NDA) | 3 docs | 2–3 weeks (Legal + CTO) |
| Technical controls (MFA enforcement, deletion pipeline) | 2 items | 2–3 weeks (Engineering) |
| Monitoring activation (Sentry + Grafana alerts) | 1 item | 1–2 days |
| Formal risk assessment + threat model | 2 docs | 1 week |
| External uptime monitoring | 1 item | Half day |
| **Total estimate** | | **5–7 weeks** |

External auditor engagement: allow 4–6 weeks for auditor selection, scoping, fieldwork, and report issuance.

**Target timeline:** SOC 2 Type I audit complete before first enterprise customer contract execution.

---

## 8. Controls Already Complete (No Further Action)

Authentication, RBAC, session management, credential encryption, audit logging, input validation, deployment controls, backup/restore, DR, incident response, privacy policy, DPDP mapping, queue durability, idempotency, TLS, encryption at rest.
