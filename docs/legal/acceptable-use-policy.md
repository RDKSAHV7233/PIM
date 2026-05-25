---
title: Acceptable Use Policy (AUP) — Structure Skeleton
audience: internal-ops
status: draft
last_updated: 2026-05-26
owner: PO / Legal
---

> **NOTE:** This document contains the section structure and key decisions that legal counsel must populate. Claude has provided the skeleton only. Do not publish without legal review.

---

## 1. Purpose and Scope

**[LEGAL TO FILL]**

Key decisions:
- This policy governs use of the Vexa PIM platform by all tenants and their Authorized Users
- Cross-reference to MSA: this AUP is an exhibit to the MSA and is incorporated by reference
- Violations of this policy are grounds for immediate suspension under the platform's suspension enforcement mechanism

---

## 2. Permitted Uses

**[LEGAL TO FILL]**

Key decisions:
- Customers may use Vexa PIM to manage their own product catalog
- Customers may integrate the Vexa API for internal automation of catalog operations
- Customers may connect their own marketplace seller accounts (Amazon, Flipkart, Meesho, ONDC)

---

## 3. Prohibited Uses

**[LEGAL TO FILL]**

Areas to address:

**Data and content:**
- Uploading product data that infringes third-party IP or trademarks
- Publishing counterfeit, unsafe, or legally restricted products via Vexa connectors
- Uploading personal data of third parties without appropriate consent

**Platform abuse:**
- Attempting to access other tenants' data (RLS isolation is enforced; attempts constitute a violation)
- Automated load testing or security scanning without prior written consent from Vexa
- Reverse-engineering, decompiling, or attempting to extract Vexa's source code
- Reselling or sublicensing access to the platform

**API and integration abuse:**
- Using the API at rates that materially degrade service for other tenants
- Creating fake API keys or attempting to bypass API key authentication
- Using the platform to relay or proxy requests on behalf of third parties not covered by the customer's subscription

**Legal compliance:**
- Using the platform to facilitate any activity that violates applicable law (Indian IT Act, GST regulations, Consumer Protection Act, DPDP Act 2023)
- Submitting product listings that violate marketplace terms of service (Amazon, Flipkart, Meesho, ONDC)

---

## 4. Security Responsibilities

**[LEGAL TO FILL]**

Key decisions:
- Customers must not share API keys across multiple unrelated businesses
- Customers must promptly rotate credentials if compromise is suspected
- Customers must report suspected security vulnerabilities to Vexa via the responsible disclosure channel (Phase 2 — to be published)

---

## 5. Enforcement and Suspension

**[LEGAL TO FILL]**

Key decisions:
- Vexa reserves the right to suspend a workspace immediately upon discovering a material AUP violation
- Suspension procedure: notice (where practical) → workspace access blocked → Customer Data preserved for 30 days
- Suspension is implemented via the platform's `accessStatus = suspended` mechanism
- Customers may appeal suspension by contacting [FILL: commercial contact]

---

## 6. Reporting Violations

**[LEGAL TO FILL]**

Key decisions:
- Contact email for reporting AUP violations by other users: [FILL]
- Vexa will investigate and respond within [FILL] business days

---

## 7. Changes to This Policy

**[LEGAL TO FILL]**

Key decisions:
- Notice period for material AUP changes: recommend 30 days
- Continued use of the Service after effective date constitutes acceptance

---

## Related documents

- `docs/legal/msa.md` — Master Service Agreement (this AUP is an exhibit)
- `docs/legal/privacy-policy.md` — Privacy Policy
- `docs/legal/terms-of-service.md` — Terms of Service
