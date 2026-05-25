---
title: DPDP Act 2023 Compliance Technical Mapping
audience: internal-eng
status: active
last_updated: 2026-05-25
owner: Engineering + Legal
---

Use this document to understand how Vexa PIM's technical implementation maps to India's Digital Personal Data Protection Act (DPDP Act) 2023 obligations.

Reference: [Privacy Policy](privacy-policy.md), [Data Retention Policy](data-retention-policy.md)

---

## 1. Scope

The DPDP Act 2023 applies to processing of digital personal data of Indian citizens. In Vexa PIM's context, personal data processed includes:

- **Workspace admin and user accounts** — email addresses, password hashes, role assignments
- **Billing contact information** — billing email addresses
- **Audit log actor records** — user IDs linked to audit events
- **Consent records** — TOS and privacy policy acceptance timestamps

Product catalog data (titles, descriptions, pricing, HSN codes) is not personal data.

---

## 2. Obligations → Implementation Mapping

### 2.1 Consent for Data Processing

**Obligation:** Obtain free, specific, informed, and unconditional consent before processing personal data.

| Implementation | Location |
|---------------|----------|
| TOS and privacy policy acceptance recorded at signup | `AccountConsentEvent` table; `PublicSignupRequest.acceptedTerms` boolean |
| Consent timestamp stored | `AccountConsentEvent.createdAt` |
| Consent version tracked | `AccountConsentEvent.consentVersion` |
| Consent cannot be bundled with other conditions | Signup form has separate terms checkbox — not pre-ticked |

**Gap:** Consent withdrawal mechanism exists (account deletion) but there is no self-serve consent-version upgrade flow if TOS terms change materially. Requires manual re-consent on next login if TOS version changes. Track in Phase 3.

### 2.2 Right of Access (Data Principal's Right)

**Obligation:** Provide personal data held about the data principal upon request.

| Implementation | Location |
|---------------|----------|
| Account data export API | `POST /api/v1/auth/account/export` → `AccountExportRequest` |
| Export job status and download | `GET /api/v1/auth/account/export/{jobId}/download` |
| Export includes: userId, role, consent records, audit log actor entries | `AccountExportRequest` processing logic |

### 2.3 Right to Correction

**Obligation:** Allow the data principal to correct inaccurate or incomplete data.

| Implementation | Location |
|---------------|----------|
| User can update their email (userId) via account settings | `PATCH /api/v1/auth/account` |
| Workspace admin can update user roles | `PATCH /api/v1/admin/users/{userId}` |

**Gap:** Email address (userId) change requires re-authentication. No self-serve display name update (display names are per workspace, managed by admin). Acceptable for Phase 3.

### 2.4 Right to Erasure

**Obligation:** Erase personal data upon valid request when no longer necessary or upon consent withdrawal.

| Implementation | Location |
|---------------|----------|
| Account deletion request API | `POST /api/v1/auth/account` (DELETE method) → `AccountDeletionRequest` |
| Soft-delete then scheduled purge | `AuthIdentity.isActive = false` → purge on schedule |
| Connector credential purge | Encrypted credentials purged on workspace offboarding |
| Audit log retention post-deletion | Retained 365 days per [Data Retention Policy](data-retention-policy.md) — permitted under DPDP Act for compliance/legal hold |

**Gap:** Fully automated deletion pipeline is not yet implemented for all data categories. Manual ops handling required for workspace offboarding during Phase 1/2. Track in Phase 3.

### 2.5 Right of Grievance Redressal

**Obligation:** Establish a grievance officer and mechanism for data principals to raise complaints.

| Implementation | Location |
|---------------|----------|
| Contact information in Privacy Policy | `docs/legal/privacy-policy.md` |
| Billing contact email per workspace | `TenantPlanProfile.billingContactEmail` |

**Gap:** No in-product grievance submission form. Contact is via email only. Acceptable for Phase 1/2.

### 2.6 Data Minimisation

**Obligation:** Collect only the personal data necessary for the stated purpose.

| Implementation | Notes |
|---------------|-------|
| Signup requires only: email, password, workspace name | No unnecessary personal fields collected |
| Billing: only billing contact email (optional) | No credit card numbers stored (Stripe handles card data) |
| API keys stored as hashed prefix + hashed secret | Full key never stored |
| Password stored as bcrypt hash (cost 12) | Never stored in plaintext |

### 2.7 Storage Limitation

**Obligation:** Retain personal data only as long as necessary.

| Implementation | Location |
|---------------|----------|
| Authentication session state expires | JWT expiry (`expiresInMinutes` parameter) |
| Auth recovery tokens expire | `AuthRecoveryToken.expiresAt` |
| Audit logs retained 365 days | [Data Retention Policy](data-retention-policy.md) §3 |
| Pending signup requests expire after 24 hours | `PublicSignupRequest.expiresAt` |

### 2.8 Accuracy

**Obligation:** Take reasonable steps to ensure personal data is accurate and up-to-date.

| Implementation | Notes |
|---------------|-------|
| Email validated on signup via class-validator `@IsEmail()` | `CreatePublicSignupDto` |
| Email verified via verification token before workspace is created | Signup verification flow |

---

## 3. Data Flows Summary

```
User signs up
   │
   ├── Personal data collected: email, password
   ├── Consent recorded: AccountConsentEvent
   ├── Email verified before workspace creation
   └── Password stored: bcrypt hash only

User uses the platform
   │
   ├── Auth events: login attempts, role changes → AuditLog (actor = userId)
   └── Session: JWT (stateless; no session table)

User requests data export
   │
   └── AccountExportRequest → async job → download link

User requests deletion
   │
   ├── AccountDeletionRequest created
   ├── AuthIdentity.isActive = false
   └── Scheduled purge (365-day audit log retention applies)
```

---

## 4. Open Gaps for Phase 3

| Gap | Priority | Owner |
|-----|---------|-------|
| Automated deletion pipeline for all data categories | High | Engineering |
| Consent version upgrade flow (re-consent on material TOS change) | Medium | Product + Engineering |
| In-product grievance submission form | Low | Product |
| Data localisation statement (where data is physically stored) | High | Legal |

See [Data Localisation Statement](data-localisation.md) when published.
