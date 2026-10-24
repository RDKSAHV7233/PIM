# P1 Security Re-Verification Under vexa_runtime

**Date:** 2026-10-24
**Branch:** fix/p0b-ci-role
**Runtime identity:** vexa_runtime (NOSUPERUSER, NOBYPASSRLS, non-owner)
**Verifier:** Claude (automated code-level + live endpoint verification)

## Verdict: CONDITIONAL PASS

Two P1 conditions must close before launch. Application is functionally operational under restricted identity.

---

## 1. Runtime Identity Verification — PASS

| Check | Result |
|---|---|
| Active DB role | vexa_runtime |
| NOSUPERUSER | Confirmed |
| NOBYPASSRLS | Confirmed |
| Owns objects | None |
| Role memberships | None |
| API readiness | 200 |
| app.vexapim.com | 200 (login page) |
| MIGRATION_DATABASE_URL absent from API service | Confirmed (security requirement F4) |

*Source: Codex production verification 2026-10-24, curl endpoint checks.*

## 2. Application-Level Tenant Isolation — PASS

### Prisma tenant-scope extension

- **63 of 67** tenant-scoped models covered by `TENANT_SCOPED_MODELS` in `apps/api/src/prisma/extensions/tenant-scope.ts`
- **2 models intentionally excluded** with documented reasons in `INTENTIONALLY_UNSCOPED_MODELS`:
  - `WorkspaceDirectory`: cross-tenant directory table (queried before tenant is known)
  - `StripeWebhookEvent`: platform-level Stripe dedup ledger (raw SQL only, nullable tenantKey)
- **CI drift guard**: `tenant-scope.spec.ts` fails the build if any new `tenantKey` model is added without being listed

### Tenant context mechanism

| Path | Mechanism | Where |
|---|---|---|
| Per-request | `?options=-c app.tenant_key=<tenant>` in connection URL | `prisma-url.ts:2` |
| Background jobs | `SELECT set_config('app.tenant_key', <tenant>, true)` in transaction | `tenant-iteration.ts:148` |

Both mechanisms set the PostgreSQL session variable that RLS policies check via `current_setting('app.tenant_key', true)`.

## 3. Database-Level RLS Coverage — CONDITIONAL PASS

### Summary

| Category | Count | Status |
|---|---|---|
| Tables with ENABLE + FORCE RLS | 54 | PASS |
| Tables with ENABLE but not FORCE | 10 | P2 |
| Tenant tables missing RLS entirely | 2 critical + 2 acceptable | P1 |

### P1: Tables missing RLS (credential-bearing)

These tables have application-level tenant isolation (Prisma extension) but NO database-level RLS policies. No raw SQL bypasses exist in production code, so cross-tenant access requires a code bug or SQL injection to exploit.

| Table | SQL name | Contains | App-level protected | Risk |
|---|---|---|---|---|
| **AuthIdentity** | `AuthIdentity` | passwordHash, roles, lock status | Yes (TENANT_SCOPED_MODELS) | P1: credential leak via raw SQL bug |
| **ApiAccessKey** | `api_access_keys` | secretHash, scopes, roles | Yes (TENANT_SCOPED_MODELS) | P1: API key leak via raw SQL bug |

**Required action:** Add ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY, and CREATE POLICY for both tables. This is a migration.

### Acceptable: Tables missing RLS by design

| Table | SQL name | Reason | Documented |
|---|---|---|---|
| WorkspaceDirectory | `WorkspaceDirectory` | Cross-tenant directory (must be queryable before tenant is known) | INTENTIONALLY_UNSCOPED_MODELS |
| StripeWebhookEvent | `stripe_webhook_events` | Platform-level dedup ledger, nullable tenantKey, raw SQL only | INTENTIONALLY_UNSCOPED_MODELS |

### P2: Tables with ENABLE but not FORCE

FORCE ROW LEVEL SECURITY applies RLS to the table owner as well as other roles. Since vexa_runtime owns no objects, the absence of FORCE does not create a runtime gap. This is defense-in-depth hardening.

| Table |
|---|
| PlanUsage |
| connector_installations |
| connector_credentials |
| connector_submissions |
| connector_webhook_events |
| TenantPlanProfile |
| ConnectorPermission |
| connector_mapping_versions |
| connector_mapping_events |
| AccessScopeAssignment |

## 4. CI Security Guardrails — PASS

| CI Job | Tests | Expected Failures | Purpose |
|---|---|---|---|
| restricted-role-lane | 45 integration tests | 0 | API runs as NOSUPERUSER NOBYPASSRLS role |
| tenant-scope.spec.ts | 5 assertions | — | Drift guard: every tenantKey model must be in extension |
| db-identity-rehearsal-v2 | Multi-PG-version rehearsal | — | Production-shaped role validation |
| validate-sec-db-call-sites | Call-site ratchet | — | Raw SQL pattern classification |

## 5. RLS Enforcement Tests — PASS

`tenant-rls-enforcement.spec.ts` verifies:
- Base client (no tenant context) sees only default tenant
- Transaction client sees only its own tenant's rows
- Cross-tenant reads return empty
- Cross-tenant writes impossible
- Tenant failure isolation (partial failure model)
- Orphan detection acknowledged as UNVERIFIED_BY_RUNTIME_ROLE

## 6. Functional Verification — PASS

| Endpoint | Status | Notes |
|---|---|---|
| `app.vexapim.com/` | 307 redirect | Working |
| `app.vexapim.com/login` | 200 | Login page renders with workspace/email/password fields |
| `app.vexapim.com/dashboard` | 302 → login | Auth gate enforced |

Multi-tenant login form confirms workspace-based tenant resolution is operational.

## 7. Areas NOT Verified (require human)

These require authenticated access or database access that this verification cannot perform:

- [ ] Cross-tenant query negative proof under vexa_runtime (requires DB access with two test tenants)
- [ ] Authenticated workflow smoke test (catalog CRUD, bulk import, connector config, media upload)
- [ ] Connector credential read/write under RLS
- [ ] Workspace provisioning flow
- [ ] API key authentication flow
- [ ] Error Authority error capture under restricted role

## Closure Requirements

### P1 (must close for launch)

1. **RLS-AUTH-001**: Add RLS policies for `AuthIdentity` table (ENABLE + FORCE + policy matching `current_setting('app.tenant_key', true)`)
2. **RLS-AUTH-002**: Add RLS policies for `api_access_keys` table (ENABLE + FORCE + same policy pattern)

### P2 (post-launch hardening)

3. Add FORCE ROW LEVEL SECURITY to 10 tables listed above
4. Run `verify-tenant-rls.cjs` against production after RLS migration
5. Extend verify-tenant-rls.cjs to cover AuthIdentity and api_access_keys tables
