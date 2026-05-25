---
title: Security Assessment / VAPT Summary
audience: internal-eng
status: skeleton — external auditor to complete
last_updated: 2026-05-25
owner: Engineering + Security
---

> **Note:** This file is a placeholder and structure template. Fill in after the external VAPT engagement completes. The sections below define what the summary must contain for enterprise customer and SOC 2 evidence purposes.

---

## 1. Assessment Details

| Field | Value |
|-------|-------|
| Auditor | **[To be filled: firm name, accreditation]** |
| Assessment type | Vulnerability Assessment and Penetration Testing (VAPT) |
| Scope | Vexa PIM API (`apps/api`), Web (`apps/web`), infrastructure |
| Methodology | **[OWASP, PTES, or other — fill after engagement]** |
| Assessment date | **[Fill after engagement]** |
| Report reference | **[Report ID from auditor]** |

---

## 2. Scope of Assessment

The following attack surfaces were in scope:

- [ ] API endpoints — authentication, authorisation, input validation, rate limiting
- [ ] Web application — XSS, CSRF, client-side injection
- [ ] Stripe webhook endpoint — signature bypass, replay attacks
- [ ] File upload / bulk import — malicious CSV, SSRF via media URL ingestion
- [ ] API key and JWT handling — token forgery, replay, privilege escalation
- [ ] Multi-tenant data isolation — cross-tenant data access
- [ ] Infrastructure — Railway service configuration, exposed ports, secrets management

Out of scope:
- [ ] Physical infrastructure (managed by Railway/Neon/Cloudflare)
- [ ] Denial of service at infrastructure layer
- [ ] Social engineering

---

## 3. Findings Summary

**[Fill after engagement]**

| Severity | Count | Remediated | Outstanding |
|---------|-------|-----------|------------|
| Critical | | | |
| High | | | |
| Medium | | | |
| Low | | | |
| Informational | | | |

---

## 4. Critical and High Findings

**[Fill after engagement — do not include full exploitation details in this document; reference the full report by ID]**

For each Critical/High finding:

---

### Finding: [Title]

| Field | Value |
|-------|-------|
| Severity | Critical / High |
| CVSS score | |
| CWE | |
| Affected component | |
| Description | |
| Remediation applied | |
| Remediation date | |
| Verified by auditor | Yes / No / Pending |

---

## 5. Remediation Status

**[Fill after engagement]**

- [ ] All Critical findings remediated and verified
- [ ] All High findings remediated or risk-accepted with justification
- [ ] Medium findings tracked in engineering backlog
- [ ] Re-test scheduled for: **[date]**

---

## 6. Known Mitigating Controls

The following controls were active at time of assessment and noted as mitigating factors:

- RBAC enforced on all API routes via `RbacGuard`
- Tenant isolation via application-layer `PrismaService.tenant(tenantKey)` scoping
- Stripe webhook signature verification before any processing
- SSRF guard on media URL ingestion (`media-ssrf-guard.test.cjs` contract)
- Input validation via `class-validator` on all request DTOs
- Credential encryption (AES-256) for connector secrets
- bcrypt (cost 12) for password hashing
- Brute-force lockout on login
- `helmet` HTTP security headers on all responses
- No raw stack traces in API error responses

---

## 7. Next Assessment

VAPT should be repeated:
- Before each major feature release affecting the attack surface
- Annually for SOC 2 Type II evidence
- After any security-relevant architectural change

Recommended auditor re-engagement: **[12 months after initial report date]**
