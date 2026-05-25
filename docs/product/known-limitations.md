---
title: Known Limitations
audience: sellers
status: active
last_updated: 2026-05-26
owner: Product
---

Use this page to understand what is not available in the current version before starting your Vexa PIM setup. These are known limitations in v0.9.1 (Pilot release), not bugs.

## 1. Import

| Limitation | Detail |
|------------|--------|
| XLSX large import not supported | Large file mode (10,001–30,000 rows) is CSV-only. XLSX files above 10,000 rows must be converted to CSV before upload. |
| Row ceiling: 30,000 per file | CSV imports above 30,000 rows are blocked in MVP. Split your catalog into multiple files. |
| JSON large import not supported | JSON imports use the standard path only (up to 10,000 rows). |

---

## 2. Channels and Connectors

| Limitation | Detail |
|------------|--------|
| Meesho direct publish not available | Meesho connector is in development. Export and direct publish are not live. Continue using Meesho Supplier Panel manually until Vexa's Meesho export ships. |
| ONDC not live | ONDC connector exists but is behind a feature flag (`FEATURE_ONDC_ENABLED`). Not available to sellers in the current release. |
| Amazon India — limited validation | Amazon India connector credentials can be entered, but full SP-API publish is not yet live. Credential validation is feature-flagged (`FEATURE_REAL_SPAPI_VALIDATION`). |

---

## 3. Billing and Payments

| Limitation | Detail |
|------------|--------|
| No self-serve upgrade | Plan upgrades are handled manually by Vexa commercial ops. Use the upgrade request form in **Admin → Plan & Usage** or contact Vexa directly. |
| No Stripe integration | Payment processing is not live in v0.9.1. Trial and paid status is set manually by ops using the internal billing API. |

---

## 4. Authentication

| Limitation | Detail |
|------------|--------|
| No OIDC enforcement | OIDC SSO is self-serve configurable (Admin → OIDC SSO) but per-tenant enforcement (requiring all users to sign in via IdP) is a future release item. Users can still sign in via password even if OIDC is configured. |
| No SSO-only mode | Both OIDC and password auth are available simultaneously in the current release. |

---

## 5. UI and UX

| Limitation | Detail |
|------------|--------|
| No dark mode | Not available. |
| Not optimised for mobile | The web app is desktop-first. Mobile browsing works but is not actively optimised. |
| English only | Locale switching exists in the UI but content is English only. |

---

## 6. Infrastructure

| Limitation | Detail |
|------------|--------|
| Single-replica only | Horizontal scaling documentation exists but connection pooling and multi-replica ops setup is Phase 3. |
| No self-serve signup | Public workspace signup (`FEATURE_PUBLIC_SIGNUP_ENABLED`) is implemented but gated. Pilot tenants are provisioned manually by ops. |

---

## 7. Reporting

| Limitation | Detail |
|------------|--------|
| Audit log retention cap | Audit log queries are bounded. Full historical export requires ops-assisted runbook (see `docs/runbooks/audit-log-retention.md`). |
| Operations counts capped at 200 | Submission Jobs and DLQ counts show `200+` when more than 200 records are in the window. Click through to the full list for older entries. |
