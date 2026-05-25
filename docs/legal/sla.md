---
title: Service Level Agreement (SLA) — Structure Skeleton
audience: internal-ops
status: draft
last_updated: 2026-05-26
owner: PO / Legal
---

> **NOTE:** This document contains the section structure and key decisions that legal counsel must populate. Claude has provided the skeleton only. Do not publish or share this document with sellers until legal text has been reviewed and approved.

---

## 1. Scope and Applicability

**[LEGAL TO FILL]**

Key decisions to document:
- Which service tiers (Pilot / Starter / Growth / Enterprise) this SLA applies to
- Whether the SLA is incorporated by reference into the MSA or is a standalone exhibit
- Effective date and revision procedure

---

## 2. Service Availability Commitment

**Proposed target (engineering baseline):** 99.5% monthly uptime for the Pilot release.

**[LEGAL TO CONFIRM AND SPECIFY]:**
- Measurement window (monthly calendar month recommended)
- Which endpoints are in scope (API `/api/v1/health`, Web app)
- Which components are excluded from uptime calculation (third-party dependencies: Neon, Upstash, Railway, Cloudflare R2)
- Definition of "unavailable" (API returns non-5xx vs. health check fails)
- Measurement method (internal monitoring vs. third-party synthetic monitoring)

---

## 3. Scheduled Maintenance

**[LEGAL TO FILL]**

Key decisions:
- Advance notice window for scheduled maintenance (recommend: 48 hours minimum)
- Maintenance window (recommended: 02:00–06:00 UTC Sunday)
- Whether scheduled maintenance counts against uptime SLA

---

## 4. Support Response Targets

**[LEGAL TO CONFIRM AND SPECIFY]**

Proposed targets for Pilot:

| Severity | Response target | Resolution target |
|----------|----------------|-------------------|
| P0 — service down | 1 hour | 4 hours |
| P1 — major feature degraded | 4 hours | 24 hours |
| P2 — minor issue | Next business day | 5 business days |

Support channel: [FILL: email / Slack shared channel / ticket system]  
Support hours: [FILL: business hours / 24×7 for P0]

---

## 5. Service Credits

**[LEGAL TO FILL]**

Key decisions:
- Credit formula (e.g., 10% monthly fee per 0.5% below SLA target)
- Maximum credit per month (recommend cap at 30% of monthly fee)
- Credit request process (customer must submit within X days of incident)
- Exclusions from credit eligibility (force majeure, customer-caused outages, beta/feature-flagged features)

---

## 6. Exclusions

**[LEGAL TO FILL]**

Standard exclusions to consider:
- Features behind feature flags (currently: ONDC, Amazon SP-API full validation, public signup)
- Outages caused by customer misconfiguration or API misuse
- Third-party marketplace API unavailability (Amazon, Flipkart, Meesho)
- Force majeure events
- Beta features explicitly marked as preview

---

## 7. Data Backup and Recovery

**Engineering baseline (to be confirmed by legal):**
- RPO: 24 hours (daily pg_dump to Cloudflare R2 + Neon 7-day PITR)
- RTO: 4 hours (manual restore + smoke test)
- These are Pilot targets. Enterprise RPO/RTO requires streaming replication (Phase 3).

**[LEGAL TO CONFIRM]:** Whether RPO/RTO commitments are contractually binding or best-effort for Pilot.

---

## 8. Reporting and Transparency

**[LEGAL TO FILL]**

Key decisions:
- Monthly uptime report format and delivery method
- Incident post-mortem distribution (P0 incidents → post-mortem within 48 hours per existing runbook)
- Status page: does Vexa commit to maintaining a public status page?

---

## 9. Revision and Termination

**[LEGAL TO FILL]**

Key decisions:
- Notice period for SLA changes
- Customer right to terminate if SLA is not met for X consecutive months
- Cross-reference to MSA termination clause

---

## Related documents

- `docs/legal/msa.md` — Master Service Agreement
- `docs/runbooks/disaster-recovery.md` — Recovery procedures supporting RPO/RTO claims
- `docs/runbooks/incident-response.md` — Incident severity definitions and response targets
