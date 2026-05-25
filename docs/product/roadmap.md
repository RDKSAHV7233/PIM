---
title: Internal Product Roadmap
audience: internal-eng
status: active
last_updated: 2026-05-26
owner: Product / CTO
---

**Visibility:** Internal only — team and investors. Do not share with sellers or post publicly.

This roadmap covers three phases from the current pilot state to enterprise-grade availability. Each phase has hard gate criteria that must ALL pass before the next phase begins.

---

## Phase 1 — First Paid Pilot

**Target:** One real seller live on a paid contract. Manual tenant provisioning. No self-serve signup required.  
**Status:** In progress (v0.9.1)

### Feature scope

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-tenant catalog (product CRUD, bulk import) | Done | CSV/XLSX/JSON up to 30k rows |
| RLS isolation between tenants | Done | Integration-tested |
| 8-role RBAC | Done | See `docs/security/rbac-permissions-matrix.md` |
| Quality review workflow (draft → in_review → approved) | Done | |
| Channel connectors: Amazon India, Flipkart | Done (outbound only) | SP-API publish feature-flagged |
| BullMQ submission pipeline | Done | Dead-letter queue, retry logic |
| JWT auth + API key program | Done | |
| OIDC SSO (self-serve, per-tenant) | Done | Per-tenant enforcement is Phase 2 |
| Tenant suspension enforcement | Done (INC-24) | Login, JWT, API key all checked |
| Trial/billing status warnings | Done (INC-24) | Banner + plan limit modal |
| Internal ops billing API | Done | 16 routes behind `PIM_COMMERCIAL_OPS_TOKEN` |
| Account export (GDPR/DPDP) | Done | |
| DPDP consent capture | Done | |
| Audit logging | Done | Bounded retention (see known limitations) |

### Gate criteria (all must pass before Phase 2)

- [ ] Suspension enforcement verified end-to-end (login, JWT, API key → `/account-suspended`)
- [ ] Trial-ending banner visible in app for a test tenant
- [ ] SLA document signed by pilot seller (L-01 — PO/Legal)
- [ ] MSA / pilot agreement template exists (L-02 — PO/Legal)
- [ ] Import Template Guide published (`docs/product/import-template-guide.md`)
- [ ] Connector setup guide for pilot marketplace published
- [ ] Known Limitations page published
- [ ] Disaster recovery and backup/restore runbooks complete
- [ ] Production deployment runbook complete
- [ ] RBAC permissions matrix complete

### Estimated effort remaining

- Engineering: ~2 days (validation and sign-off)
- Documentation: complete (docs D-01 through D-11 written)
- Legal: SLA + MSA (PO/Legal — parallel track)

---

## Phase 2 — General Availability

**Target:** Self-serve signup. Stripe billing live. Any qualified seller can onboard without ops involvement.  
**Dependencies:** Phase 1 gate criteria all pass; Stripe account configured; pricing approved by PO.

### Feature scope

| Feature | Status | Notes |
|---------|--------|-------|
| Public self-serve signup (`/signup`, `/signup/verify`) | INC-23B — to build | Backend complete; web pages missing |
| `FEATURE_PUBLIC_SIGNUP_ENABLED` rollout | Ready to toggle | Gated env var |
| Stripe subscription management | INC-24B — to build | `TenantPlanProfile` schema ready |
| Stripe webhooks (subscription lifecycle) | To build | `invoice.paid`, `payment_failed`, `subscription.deleted` |
| `billingStatus` auto-update from Stripe | To build | Flows through `CommercialStateService` |
| Customer email notifications | To build | Trial ending (7d, 1d), payment failed, suspension warning |
| Self-serve plan upgrade (Stripe checkout) | To build | |
| Per-tenant OIDC enforcement (SSO-only mode) | Phase 2 | Currently both auth methods available simultaneously |
| Meesho connector | To build | Manual Supplier Panel still recommended |
| ONDC connector | Feature-flagged (`FEATURE_ONDC_ENABLED`) | Enable when integration tested |

### Gate criteria

- [ ] `/signup` and `/signup/verify` pages live and passing integration tests
- [ ] `FEATURE_PUBLIC_SIGNUP_ENABLED=true` in production
- [ ] Stripe subscription created on workspace verification
- [ ] Stripe webhooks handle all subscription lifecycle events
- [ ] `billingStatus` auto-updates from Stripe events
- [ ] Customer notifications working for trial ending, payment failed, suspension
- [ ] Pricing page approved and published (PO/Legal)
- [ ] Seller Quick-Start Guide published
- [ ] API & Webhook Integration Guide published
- [ ] Responsible disclosure policy published

### Estimated effort

| Track | Effort |
|-------|--------|
| INC-23B web signup pages | 2–3 days |
| Stripe integration (INC-24B) | 5–7 days |
| Customer notifications cron | 2 days |
| Phase 2 docs (D-12 through D-18) | 3 days |
| Legal (pricing, security policy, disclosure) | PO/Legal parallel |

---

## Phase 3 — Enterprise Ready

**Target:** Sell to Indian enterprise accounts. SOC 2 roadmap. VAPT evidence. Data localisation statement. Horizontal scale documented.  
**Dependencies:** Phase 2 GA; external security assessment vendor engaged; legal counsel retained.

### Feature scope

| Feature | Status | Notes |
|---------|--------|-------|
| Connection pooling (PgBouncer / Neon pooled endpoint) | 3A-1 — to build | Required at multi-tenant enterprise load |
| Horizontal worker scaling | Documented only | BullMQ idempotency already in place |
| Sentry + OpenTelemetry activation | Config only | Conditional on `SENTRY_DSN` env var |
| MSA finalized (PO/Legal) | Phase 3 | Draft from Phase 1 |
| SOC 2 Type I readiness assessment | External | Vendor engagement required |
| VAPT security assessment | External | Required before enterprise contracts |
| Data localisation statement | Legal | Confirm India-resident data storage |
| DPDP Act compliance technical mapping | Docs | Link obligations to code |
| API versioning policy | Docs | Backward compatibility contract for enterprise integrations |

### Gate criteria

- [ ] VAPT / security assessment completed by external auditor
- [ ] SOC 2 Type I readiness assessment complete
- [ ] Data localisation statement published
- [ ] DPDP compliance technical mapping published
- [ ] MSA finalized and reviewed by legal counsel
- [ ] API versioning policy published
- [ ] Connection pooling implemented and tested under load
- [ ] Horizontal scaling architecture documented

### Estimated effort

| Track | Effort |
|-------|--------|
| Connection pooling | 1–2 days |
| Observability activation | 1 day |
| Phase 3 docs (D-19 through D-25) | 4–5 days |
| External VAPT | 4–6 weeks (external vendor) |
| SOC 2 readiness | 6–12 weeks (external auditor + internal remediation) |
| Legal (data localisation, MSA finalization) | PO/Legal |

---

## What is NOT on the roadmap (v0.9.1 known gaps)

These items are out of scope until explicitly prioritized:

- Dark mode
- Mobile-optimised layout
- Multi-language / locale switching
- Full historical audit log export (bounded in current release)
- Meesho direct API publish (manual Supplier Panel recommended)
- Amazon India full SP-API validation (feature-flagged, limited availability)

See `docs/product/known-limitations.md` for the complete list.

---

## Dependencies and risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Stripe approval delayed | Low | Apply early; use manual billing ops as fallback during Phase 1 |
| VAPT findings require significant remediation | Medium | Begin SOC 2 gap analysis before VAPT to surface issues earlier |
| Amazon SP-API scopes rejected | Medium | Document limitations clearly; position as outbound-only for pilot |
| Neon PITR window insufficient for enterprise RPO | Medium | Enterprise SLA will require streaming replication (Phase 3+) |
| RLS regression under horizontal scale | Low | `test:integration:rls-isolation` runs in CI; add to load test suite in Phase 3 |
