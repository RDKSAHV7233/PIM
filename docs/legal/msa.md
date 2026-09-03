---
title: Master Service Agreement (MSA) — Structure Skeleton
audience: internal-ops
status: draft
last_updated: 2026-09-03
owner: PO / Legal
---

> **NOTE:** This document contains the section structure and key decisions that legal counsel must populate. Claude has provided the skeleton only. Do not use this as a contract without legal review. Have a qualified legal counsel review and finalize before presenting to any customer.

---

## 1. Parties

**[LEGAL TO FILL]**

- Vexa (legal entity name, registered address, jurisdiction)
- Customer (defined as the contracting entity — workspace/tenant owner)

---

## 2. Definitions

**[LEGAL TO FILL]**

Key terms to define:
- "Service" — Vexa PIM platform including API, web app, worker, and storage
- "Workspace" — tenant-level account provisioned by Vexa ops
- "Authorized Users" — individuals with active user accounts within the Customer's workspace
- "Customer Data" — product catalog data, media, and metadata uploaded by Customer
- "Confidential Information"
- "Effective Date"

---

## 3. License and Access

**[LEGAL TO FILL]**

Key decisions:
- Grant: non-exclusive, non-transferable license to access the Service during the subscription term
- Scope limitation: Customer may not resell, sublicense, or white-label the Service
- API access: permitted for Customer's internal integration use only
- Restrictions on automated scraping, load testing, or security scanning without prior written consent

---

## 4. Customer Obligations

**[LEGAL TO FILL]**

Key points:
- Customer is responsible for accuracy of product data submitted to marketplaces
- Customer must ensure Authorized Users comply with Acceptable Use Policy (`docs/legal/acceptable-use-policy.md`)
- Customer must maintain security of API keys and credentials
- Customer must promptly notify Vexa of suspected unauthorized access

---

## 5. Data Ownership and Processing

**[LEGAL TO FILL — cross-reference DPA]**

Key decisions:
- Customer retains ownership of Customer Data at all times
- Vexa processes Customer Data solely to deliver the Service
- Data Processing Agreement (DPA) governs personal data processing — cross-reference `docs/legal/dpa.md`
- Data residency: [FILL — confirm India vs. global; cross-reference data localisation statement once written]
- Vexa's right to use aggregated, anonymised data for service improvement: [FILL — opt-in vs. opt-out vs. prohibited]

---

## 6. Fees and Payment

**[LEGAL TO FILL]**

Key decisions:
- Subscription fees: per plan tier (Starter / Growth / Enterprise — see `docs/product/pricing.md` once written)
- Billing cycle: monthly or annual
- Payment method: [Pilot: manual invoice; GA: Stripe]
- Late payment: grace period and interest terms
- Price change notice period (recommend: 30 days)

---

## 7. Term and Termination

**[LEGAL TO FILL]**

Key decisions:
- Initial term (Pilot: 90 days recommended)
- Renewal: auto-renew or explicit renewal required
- Termination for convenience: either party with X days notice
- Termination for cause: material breach, cure period
- Effect of termination: Customer Data export window (recommend: 30 days post-termination); then deletion per `docs/legal/data-retention-policy.md`

---

## 8. Service Levels

SLA commitments are in `docs/legal/sla.md`. This section should cross-reference the SLA as an exhibit and confirm whether SLA credits are Customer's sole remedy for availability failures.

**[LEGAL TO CONFIRM]:** Whether SLA is an exhibit to this MSA or a separate agreement.

---

## 9. Intellectual Property

**[LEGAL TO FILL]**

Key decisions:
- Vexa owns the Service platform, software, and all platform IP
- Customer owns Customer Data and all product catalog content
- No implied license to Vexa's brand, marks, or platform code

---

## 10. Confidentiality

**[LEGAL TO FILL]**

Standard mutual confidentiality clause covering:
- Definition of Confidential Information
- Obligations of receiving party
- Exceptions (publicly available, independently developed, required by law)
- Duration: during term + 3 years post-termination (typical)

---

## 11. Warranties and Disclaimers

**[LEGAL TO FILL]**

Key decisions:
- Vexa warrants that the Service will materially conform to documentation during the subscription term
- Vexa disclaims warranties of merchantability, fitness for a particular purpose, and uninterrupted operation
- Pilot-specific: during Pilot, the Service is provided "as available" with limited SLA

---

## 12. Limitation of Liability

**[LEGAL TO FILL]**

Key decisions:
- Cap on Vexa's aggregate liability: [recommend: fees paid in the 12 months preceding the claim]
- Exclusion of consequential, indirect, incidental damages
- Carve-outs: death/personal injury, fraud, wilful misconduct

---

## 13. Indemnification

**[LEGAL TO FILL]**

Key decisions:
- Vexa indemnifies Customer against IP infringement claims arising from the Service (except Customer-supplied content)
- Customer indemnifies Vexa against claims arising from Customer Data or Customer's use of the Service in violation of this MSA

---

## 14. Governing Law and Dispute Resolution

**[LEGAL TO FILL]**

Key decisions:
- Governing law: [recommend: India — confirm jurisdiction with legal counsel]
- Dispute resolution: good faith negotiation → mediation → arbitration or courts
- Venue: [FILL]

---

## 15. General

**[LEGAL TO FILL]**

Standard boilerplate:
- Entire agreement clause
- Amendment procedure
- Severability
- Waiver
- Force majeure
- Notices (email sufficient? postal required?)
- Assignment: Vexa may assign on change of control with notice; Customer may not assign without consent

---

## Related documents

- `docs/legal/sla.md` — Service Level Agreement (exhibit)
- `docs/legal/dpa.md` — Data Processing Agreement
- `docs/legal/acceptable-use-policy.md` — Acceptable Use Policy (exhibit)
- `docs/legal/data-retention-policy.md` — Data Retention Policy
