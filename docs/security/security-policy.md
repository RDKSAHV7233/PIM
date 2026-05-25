---
title: Information Security Policy
audience: internal-eng
status: skeleton — Legal/CTO to complete and sign off
last_updated: 2026-05-25
owner: CTO + Legal
---

> **Note:** This skeleton defines the required sections for SOC 2 Type I evidence. The CTO must review and approve the policy; Legal must confirm the governing law reference and liability language. Engineering has filled in current technical control state.

---

## 1. Purpose and Scope

This policy establishes the information security principles and minimum controls for Vexa PIM's systems, infrastructure, and data.

**Scope:** All production systems, source code, credentials, and data processed by Vexa PIM, including systems operated by contracted third parties (Neon, Cloudflare, Railway).

**Owner:** CTO  
**Review frequency:** Annually, or on material architecture change  
**Effective date:** **[CTO: set date on sign-off]**

---

## 2. Roles and Responsibilities

| Role | Responsibilities |
|------|----------------|
| CTO | Policy owner; approves exceptions; accountable for security program |
| Engineering leads | Implement controls; review security-relevant PRs; maintain runbooks |
| All engineers | Follow secure coding practices; report incidents; protect credentials |
| Product Ops | Access provisioning; monitor billing and commercial state; handle offboarding |

---

## 3. Access Control

### 3.1 Principle of Least Privilege
All system access is granted at the minimum level required. The 8-role RBAC hierarchy (`viewer → editor → reviewer → publisher → channel_manager → connector_admin → admin → system_admin`) enforces this at the API layer.

Reference: [`docs/security/rbac-permissions-matrix.md`](rbac-permissions-matrix.md)

### 3.2 Authentication Requirements
- Passwords must be at least 8 characters. bcrypt (cost 12) is used for storage.
- MFA (TOTP) is available for all accounts. **[CTO: decide if MFA is required for admin roles]**
- Session timeout: 240 minutes default; configurable per workspace.
- Brute-force lockout: enforced after repeated failed logins.

### 3.3 API Keys
- API keys are scoped to a tenant and a role.
- Keys are stored as a hashed prefix + hashed secret; the full key is shown only once at creation.
- Keys can be revoked immediately and have configurable expiry.

### 3.4 Offboarding
When an engineer or contractor leaves:
1. Revoke all API keys and tokens within **[CTO: set timeframe — e.g., 24 hours]** of departure.
2. Remove from GitHub organization.
3. Remove from Railway, Neon, and Cloudflare access.
4. Rotate `CREDENTIAL_ENCRYPTION_KEY_V1` and `PIM_COMMERCIAL_OPS_TOKEN` if the departing individual had access.

---

## 4. Credential Management

- Secrets are never committed to version control.
- Production secrets live in Railway Variables only.
- Local dev secrets live in `.env` (gitignored).
- Connector credentials are encrypted with AES-256 before database storage.
- Encryption keys must be at least 32 characters.
- Key rotation procedure: [`docs/runbooks/credential-key-rotation.md`](../runbooks/credential-key-rotation.md)

---

## 5. Secure Development

- All production changes require a GitHub pull request and at least one review.
- Security-relevant changes (auth, RBAC, billing, credential handling) require CTO review.
- TypeScript strict mode is enabled; linting runs on every PR.
- Input validation is applied to all external inputs via `class-validator`.
- No raw stack traces are exposed in API error responses.
- OWASP Top 10 is the minimum baseline for code review.

---

## 6. Vulnerability Management

- Engineering subscribes to security advisories for all production dependencies.
- Critical vulnerabilities (CVSS ≥ 9.0): patched within **[CTO: set — e.g., 72 hours]**.
- High vulnerabilities (CVSS 7.0–8.9): patched within **[CTO: set — e.g., 7 days]**.
- Medium/Low: addressed in the next planned release.
- VAPT engagement: annually and before enterprise customer onboarding. See [`docs/security/vapt-summary.md`](vapt-summary.md).

---

## 7. Data Classification

| Class | Examples | Handling |
|-------|---------|---------|
| Confidential | API keys, encryption keys, DB credentials, `STRIPE_SECRET_KEY` | Never logged, never shared, rotated on suspected compromise |
| Restricted | User passwords (hashed), connector credentials (encrypted), audit logs | Access restricted to ops with documented need |
| Internal | Product catalog data, workspace configuration, billing state | Tenant-isolated; accessible to authenticated workspace users only |
| Public | API documentation, OpenAPI spec, public-facing product pages | No restrictions |

---

## 8. Incident Response

Reference: [`docs/runbooks/incident-response.md`](../runbooks/incident-response.md)

For security incidents specifically:
- **Data breach suspected:** notify CTO within 1 hour; assess scope; determine notification obligation under DPDP Act 2023.
- **Credential compromise suspected:** immediately rotate affected credentials; revoke affected sessions; audit access logs.
- **[Legal: add breach notification timeline obligation — DPDP Act 2023 requires notification to Data Protection Board within 72 hours of becoming aware]**

---

## 9. Third-Party Risk

| Provider | Data processed | Security review |
|----------|---------------|----------------|
| Neon (database) | All tenant data | SOC 2 Type II certified |
| Cloudflare (CDN, R2) | Media files, CDN edge | SOC 2 Type II certified |
| Railway (hosting) | Processes API traffic | **[Legal: review Railway's compliance posture]** |
| Stripe (payments) | Payment data | PCI-DSS Level 1 |
| Sentry (error tracking, optional) | Error traces with user IDs | **[Legal: review Sentry DPA]** |

---

## 10. Policy Exceptions

Exceptions must be:
1. Submitted to the CTO in writing.
2. Approved with documented compensating controls.
3. Time-limited (maximum **[CTO: set — e.g., 90 days]** before re-review).
4. Logged in the exception register.

---

## 11. Review and Approval

**[CTO: sign and date this section on approval]**

| Field | Value |
|-------|-------|
| Approved by | |
| Title | CTO |
| Date | |
| Next review | |
