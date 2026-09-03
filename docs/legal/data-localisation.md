---
title: Data Localisation Statement
audience: sellers
status: skeleton — PO/Legal to complete
last_updated: 2026-08-29
owner: Legal + Engineering
---

> **Note to Legal:** This skeleton defines the sections required. Engineering has filled in the technical facts. Legal must review, add the regulatory position, and confirm sign-off before this document is published.

> **Current technical correction, 2026-08-29:** Engineering facts below are
> aligned to the current Railway/R2 baseline. Legal and Engineering must still
> confirm storage regions, DPAs, subprocessors, and publication wording before
> this statement is shared externally.

Use this document to disclose where Vexa PIM stores and processes personal data, in accordance with the DPDP Act 2023 and customer contractual obligations.

---

## 1. Purpose

This statement explains:
- where Vexa PIM stores personal data;
- whether any personal data is transferred outside India; and
- what protections apply to any cross-border transfers.

---

## 2. Data Storage Locations (Technical Facts)

| Data category | Storage system | Region | Notes |
|--------------|---------------|--------|-------|
| All database records (user accounts, audit logs, product data, billing records) | Railway-hosted self-managed PostgreSQL service with Railway volume | **[LEGAL/OPS: confirm Railway region and data-residency contract]** | Current baseline is not Neon and has no managed PITR |
| Media files (product images, documents) | Cloudflare R2 | **[LEGAL/OPS: confirm bucket region and jurisdictional setting]** | Cloudflare is US-incorporated; region and data-location claims must match the actual bucket |
| Backup exports | Cloudflare R2 | **[LEGAL/OPS: confirm bucket region and retention policy]** | Daily `pg_dump` export when backup secrets/workflow are configured |
| Queue state (BullMQ jobs, rate-limit/session support) | Redis provider used by the environment | **[LEGAL/OPS: confirm selected provider and region]** | May contain job metadata or user/session identifiers depending on queue payload |
| Error traces (if Sentry enabled) | Sentry.io | US (Sentry default) | Contains user IDs in stack traces; may constitute personal data processing |
| Distributed traces (if OTLP enabled) | Configured OTLP endpoint | **[LEGAL: confirm when enabled]** | |

---

## 3. Cross-Border Data Transfers

**[LEGAL: This section requires legal analysis. Draft position for Legal review:]**

Vexa PIM currently uses infrastructure operated by third-party providers, including Railway and Cloudflare in the current baseline. If data is stored in non-India regions, this may constitute cross-border transfer under the DPDP Act 2023.

Key decisions Legal must make:
- [ ] Which Railway region and data-location terms apply to the current Postgres, API, worker, and Redis services?
- [ ] Which Cloudflare R2 bucket location and jurisdictional settings are configured for media and backup exports?
- [ ] Which Redis provider is active in production, and what region/DPA applies?
- [ ] Under DPDP Act § 16, cross-border transfers are permitted where the Central Government has not restricted the destination country. Are there any current restrictions on the US?
- [ ] Are standard contractual clauses (SCCs) or equivalent data processing agreements in place with Railway, Cloudflare, Redis provider, Sentry if enabled, Stripe if enabled, and marketplace/API providers where applicable?

---

## 4. Protections Applied

Regardless of storage location, the following protections apply to all personal data:

- Encryption in transit: TLS 1.2+ enforced by Railway and Cloudflare CDN
- Encryption at rest: application-level AES-256 for connector credentials; R2 encryption where configured; Railway Postgres volume/provider encryption requires current vendor confirmation
- Access controls: RBAC on all API endpoints; encrypted connector credentials
- Audit logging: all access and mutations logged in `AuditLog`

---

## 5. Contact

For questions about data localisation:

**[LEGAL: Add contact name, role, email, and grievance officer details]**

---

## 6. Review and Update

This statement is reviewed when:
- the hosting region is changed;
- a new data processor is added; or
- a material change in DPDP Act guidance occurs.

Last technical review: 2026-09-03 (Engineering)
Legal sign-off: **[PENDING]**
