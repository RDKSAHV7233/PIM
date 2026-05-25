---
title: Data Localisation Statement
audience: sellers
status: skeleton — PO/Legal to complete
last_updated: 2026-05-25
owner: Legal + Engineering
---

> **Note to Legal:** This skeleton defines the sections required. Engineering has filled in the technical facts. Legal must review, add the regulatory position, and confirm sign-off before this document is published.

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
| All database records (user accounts, audit logs, product data, billing records) | Neon (PostgreSQL) | **[LEGAL: confirm region — us-east-1 or ap-south-1]** | Neon is a US-incorporated company; physical data location depends on project region selection |
| Media files (product images, documents) | Cloudflare R2 | **[LEGAL: confirm — default is US; India data centre available]** | Cloudflare is US-incorporated |
| Queue state (BullMQ jobs) | Railway Redis | **[LEGAL: confirm region]** | Ephemeral; does not contain personal data |
| Error traces (if Sentry enabled) | Sentry.io | US (Sentry default) | Contains user IDs in stack traces; may constitute personal data processing |
| Distributed traces (if OTLP enabled) | Configured OTLP endpoint | **[LEGAL: confirm when enabled]** | |

---

## 3. Cross-Border Data Transfers

**[LEGAL: This section requires legal analysis. Draft position for Legal review:]**

Vexa PIM currently uses infrastructure operated by US-incorporated companies (Neon, Cloudflare, Railway). If data is stored in non-India regions, this constitutes cross-border transfer under the DPDP Act 2023.

Key decisions Legal must make:
- [ ] Which data centre region has been contracted for Neon? Confirm `ap-south-1` (Mumbai) vs `us-east-1`.
- [ ] Is Cloudflare R2 configured with an India data centre? If not, declare cross-border transfer.
- [ ] Under DPDP Act § 16, cross-border transfers are permitted where the Central Government has not restricted the destination country. Are there any current restrictions on the US?
- [ ] Are standard contractual clauses (SCCs) or equivalent data processing agreements in place with Neon, Cloudflare, and Railway?

---

## 4. Protections Applied

Regardless of storage location, the following protections apply to all personal data:

- Encryption in transit: TLS 1.2+ enforced by Railway and Cloudflare CDN
- Encryption at rest: Neon transparent data encryption; R2 AES-256
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

Last technical review: 2026-05-25 (Engineering)  
Legal sign-off: **[PENDING]**
