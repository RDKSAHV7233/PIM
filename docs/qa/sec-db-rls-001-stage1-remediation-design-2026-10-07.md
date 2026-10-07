# SEC-DB-RLS-001 Stage 1: remediation design (docs only)

Date: 2026-10-07
Baseline: `origin/main` at `4dc700a3`
Issue: #1189. Evidence: `SEC-DB-RLS-001-production-identity-evidence-2026-10-06.md` (record, D-nn) and its RAW register (R-nn), merged in #1203 (`ef144449`). Identity model: #1198. Call-site classification: #1193. Lane: #1195.
Type: **design only. No production access, no application change, no role, grant, ownership, RLS or credential change.**

Status labels follow the evidence record: `REPO FACT`, `CURRENT PRODUCTION FACT` (cites the record), `PROPOSED TARGET STATE`, `GOVERNANCE DECISION`, `VERIFICATION REQUIRED`.

## 1. Objective and what this design is not

The ordinary Vexa runtime identity must be unable to bypass database tenant isolation accidentally or implicitly; cross-tenant access must require an explicit, separately governed privileged path. This design does **not** claim RLS stops a fully compromised API: tenant context is connection-supplied through `app.tenant_key` (record D-021, N-2).

Root cause to remove (record D-006, D-023): `vexa_app_v2` is a SUPERUSER and so passes every RLS policy. It is not an ownership problem: the 10 RLS-enabled-but-not-forced tables are owned by `postgres`.

## 2. Decisions this design records

| # | Decision | Source |
|---|---|---|
| S1 | `app.ai_maintenance = 'on'` is not an acceptable governed path; it is removed (D-022). | GOVERNANCE DECISION, 2026-10-07 |
| S2 | **#1193 section 3's "narrow SELECT-only maintenance policy" exception is superseded.** No policy may grant cross-tenant access on the strength of a session setting the ordinary runtime can set. | follows from S1 |
| S3 | **No general BYPASSRLS maintenance role**, and no BYPASSRLS writer. | owner, 2026-10-06 and 2026-10-07 |
| S4 | Stage 1 is the cutover gate; Stage 2 is progressive hardening and is not a cutover precondition unless Security/SRE name a specific Stage 2 item as a blocking risk. | owner, 2026-10-07 |

## 3. Supersession of #1193 section 3 (concrete edits, in later PRs)

REPO FACTS to change, each in the PR named:

- `docs/qa/sec-db-rls-001-call-sites.v1.json`: the `maintenance-read` remediation is removed; `intelligence/intelligence-reservation-maintenance.service.ts` moves from class D to class A (7.2a); `internal-ops/internal-ops-alerts.service.ts` and `internal-ops-summary.service.ts` change from "maintenance policy" to tenant iteration (7.7); `billing/commercial-requests.service.ts` (class C) is decided as tenant iteration (7.7).
- `scripts/validate-sec-db-call-sites.cjs`: the ratchet stops accepting `maintenance-read` and fails on any inventory entry that relies on a setting-gated policy.
- `packages/db/identity/identity-model.v1.json`: `noCrossTenantMaintenanceRole` loses the "or a SELECT-only maintenance policy" wording (7.8).
- `docs/qa/sec-db-rls-001-call-site-classification-2026-10-06.md` section 3: replaced, not annotated, with the S2 rule (this design's PR carries that replacement).

## 4. D-022 replacement: tenant iteration (option A)

`apps/api/src/intelligence/intelligence-reservation-maintenance.service.ts` has two readers of the flag, both through `withMaintenanceRead` (line 131):

1. `runSweep` finds tenants that have an expired reservation (`distinct tenantKey`), then already acts per tenant through `control.sweepExpired({ tenantKey })`. Replacement: iterate the tenant set and query each tenant under its own context. State changes already happen tenant by tenant.
2. `auditCounters` is a read-only aggregate across tenants (policies and platform periods joined to charges and reservations). Replacement: per tenant, sum the charges for each scope; add the tenant sums for the platform scopes; compare to the platform counters (`ai_platform_budget_periods` and `ai_platform_controls` have no RLS by design). The result must equal today's drift report; this is a test (same seeded data, old and new method agree).

Option B (a reporter identity) is rejected for the API path: the API must never hold a bypass credential. It remains available only if the audit leaves the API process and becomes an operator script.

**Expand then contract, with a deployment gate.**
- 7.2a (behavior): sweeper and audit use iteration; the policies still exist and are unused. Tests: (i) fault injection: a session that sets `app.ai_maintenance = 'on'` as the restricted runtime still sees only its own tenant (this fails today, which proves the test is real); (ii) a non-default tenant's expired reservation is found and swept (positive assertion); (iii) mutation: removing the iteration makes (ii) fail; (iv) the audit equals the old result on identical data.
- **7.2b (migration) opens only after 7.2a is merged, deployed and runtime-verified** (the deployed sweeper processes a non-default tenant with a non-empty result). Dropping the policies first would silently empty the deployed sweeper. It then drops the three `ai_maintenance_read_*` policies, adds a CI ratchet forbidding any policy gated on a `current_setting('app.*')` value without a tenant condition, and the probe re-run shows none.

## 5. The tenant-iteration helper (7.1)

One shared helper, used by every class A and A2 job. It must not become a serial bottleneck or let one tenant stall the rest.

- **Tenant source:** `WorkspaceDirectory` (an unscoped table by design) plus the default tenant, listed in pages (keyset by tenant key), never as one unbounded read.
- **Per-tenant context:** `runWithTenantContext` or `prisma.tenant(key)`; no job touches the direct client.
- **Bounded concurrency:** a configurable limit (default small); never above it.
- **Per-tenant timeout and cancellation:** one slow or hung tenant is abandoned with a counted `timedOut`, and the rest continue.
- **Failure isolation and accounting:** per-tenant try/catch; the run returns `{ listed, processed, failed, timedOut, skipped, perTenant: [{ key, durationMs, outcome }] }`; failures are logged with the tenant key (never data) and counted, never swallowed.
- **Zero-tenant visibility:** a run that lists zero tenants is an explicit warning and a metric, not a silent success.
- **Positive assertions** stay in the jobs' tests: seed a non-default tenant, assert a non-empty outcome.

Tests: a hanging tenant does not block others; concurrency never exceeds the bound; a failing tenant is counted and the run still returns; zero tenants is visible; pagination covers more tenants than one page.

## 6. Identity delta against the I1 model (7.8, tooling only)

I1 (`packages/db/identity/identity-model.v1.json`) already defines `vexa_migrator`, `vexa_runtime`, `vexa_backup`, `vexa_ops`. This design extends it; it does not add a second model.

| Identity | Delta | Reason |
|---|---|---|
| `vexa_runtime` | no new privilege; later (Stage 2) fewer | LOGIN, NOSUPERUSER, NOBYPASSRLS, owns nothing, no DDL, no role management, only required DML |
| `vexa_migrator` | none; stays BYPASSRLS (I1 finding F1) | data-fixing migrations must see every tenant; never reachable by the API. Owner may instead choose NOBYPASSRLS at the cost of per-tenant context in every data migration |
| `vexa_backup` | none | BYPASSRLS only because `pg_dump` must read forced-RLS tables; SELECT only |
| `vexa_ops` | **add** narrow DML for the sellable-SKU backfill: `SELECT` on `Product`, `SELECT` and `INSERT` on `Variant`, with explicit tenant iteration; platform controls as today | REPO FACT: the backfill reads `product`, reads and creates `variant` (`scripts/sellable-sku-variantless-backfill.cjs` lines 118, 133, 157, 212). NOSUPERUSER, NOBYPASSRLS, no general writer |
| `vexa_reporter` | **new**: LOGIN, NOSUPERUSER, read-only, BYPASSRLS only because reports span tenants, owns nothing, no DDL, no writes; `SELECT` on `connector_submissions`, `Product`, `Variant`, `media_assets` | REPO FACT: the audit report reads `connectorSubmission`, `product`, `variant`; the media report reads `mediaAsset`. Its credential must be unreachable by the API process |

A fifth role that appears without a manifest entry fails the verifier (existing rule). Table names are fixed by the schema; the verifier fails on an unclassified table (existing rule).

## 7. Call-site migration slices (7.2 to 7.7)

Order is dependency-driven and every slice carries a positive-result assertion and passes the restricted-role lane. Slices already merged: M1a (#1200), M1b (#1202).

| Slice | Content |
|---|---|
| 7.1 | tenant-iteration helper (section 5) |
| 7.2a / 7.2b | D-022 replacement (section 4) |
| 7.3 | credential-rotation sweeps (`rotateKey`, `rotateAllCredentials`) to iteration; **before any key rotation**, because `rotateAllCredentials` runs on heartbeat startup when the key version changes and would otherwise re-encrypt only the default tenant while reporting success |
| 7.4 | M2: tenant provisioning seeds on the tenant client and fail loudly; `auth.service` pre-tenant lookups reviewed (class C) |
| 7.5a-c | M3 sweepers by domain: (a) stale-recovery and lease sweepers, (b) heartbeat and WooCommerce reconciliation, (c) media-integrity and plan-usage rollup |
| 7.6 | M4 billing and scans: grace-period escalation, commercial reminders, outbound-webhook stuck delivery |
| 7.7 | M5 dashboards by iteration, M6 class R explicit tenant arguments, Stripe and commercial-requests decisions, M1c removal of the optional direct-client constructor fallback |

Each PR stays within 60 files, 2500 lines and 3 risk domains.

## 8. Deploy, backup and operator wiring (7.9a-c), opt-in

Nothing here changes production until a human creates credentials and sets variables. Every change is "use the new variable when set, otherwise behave as today".

- **7.9a migrator:** `scripts/prisma-migrate-deploy.cjs` (today `DATABASE_URL_DIRECT`, then `DATABASE_URL`, run by Railway `preDeployCommand` and by `ci.yml`) prefers `MIGRATION_DATABASE_URL`; `apply-grants` runs immediately after `migrate deploy`; rehearsal proves the runtime cannot migrate and the migrator can. Backup coupling is fail-loud by design (I1 F3), so this ordering is mandatory.
- **7.9b backup:** `backup-r2-daily.yml` and `backup-r2-daily-observability.yml` (environment `staging`, secrets `STAGING_DATABASE_URL_DIRECT`, `OBSERVABILITY_DATABASE_URL`) prefer `BACKUP_DATABASE_URL`; a restore-test script reuses `scripts/db-restore.sh`; the failure alert path stays as fixed in #1197 and #1201. A backup existing in R2 is not enough: at least one restore test is required before cutover.
- **7.9c reporter and ops:** the two audit/report workflows and the backfill workflow all use one secret today (`STAGE3_DATABASE_URL`, environment `production`). Split: reports use `REPORTER_DATABASE_URL`, the backfill uses `OPS_DATABASE_URL` and iterates tenants.

`VERIFICATION REQUIRED` (record section 18): which role each existing secret holds. Until a person reads the secret names against the identity output, the blast radius of backups and operator workflows is not sized.

## 9. Production-shaped rehearsal v2 (7.10), the acceptance bar

Extends `scripts/db-identity/rehearse.cjs` (88 checks, PostgreSQL 16 and 18) with: reproduce the ownership split exactly (record D-014); old state; create roles; grants; ownership transfer; migrate as `vexa_migrator`; run the API suite and workers as `vexa_runtime`; backup **and restore**; reporter; ops with tenant iteration; the restricted-role lane aligned to `vexa_runtime`; rollback; negative tests (cross-tenant access fails closed; the runtime cannot migrate; setting `app.ai_maintenance` grants nothing). Acceptance: the ordinary runtime is NOSUPERUSER, NOBYPASSRLS and owns nothing; tenant tests pass; cross-tenant negatives fail closed; a probe run as `vexa_runtime` reports no bypass.

## 10. Cutover design (design only; no production action without explicit authorization)

Preconditions (Sprint 9): Stage 1 merged; 7.2b deployed and probe-verified; exact-head CI green; a real restore test from an R2 backup into a scratch database; backup-failure alert dry run verified; rollback rehearsal passed; candidate roles verified; the GitHub branch-protection or rulesets disposition recorded; Security and SRE sign-off by name and date.

Sequence:
1. Re-run the production probe; confirm it still equals the ownership fixture. Take a before-snapshot (`snapshot --out before.json`) and a backup under the current identity; restore it to a scratch database.
2. SRE creates the role credentials and the new Railway variables (human): migrator, runtime, backup, reporter, ops.
3. `create-roles`, `plan-ownership` (reviewed), `apply-ownership` (one transaction; metadata only, data hashes unchanged), `apply-grants`, `verify`.
4. Run the probe as each candidate role and compare with the rehearsal's expectations.
5. Set `MIGRATION_DATABASE_URL`; switch the runtime `DATABASE_URL*` to `vexa_runtime`; restart.
6. Verify: health and readiness, workers produce non-empty per-tenant results, a migration dry run as the migrator, a tenant-isolation smoke, backup workflow and a restore, reporter and ops dry runs.
7. Observe for a defined window (proposed 7 days); the previous credential stays valid and `vexa_app_v2` is untouched.
8. Run the production probe under the deployed role; update the evidence record; Security and SRE sign off.

Rollback conditions: any invariant fails (a tenant-isolation test fails; a cross-tenant job returns empty where non-empty is expected; a migration fails; a backup fails; a health regression). Rollback: point `DATABASE_URL*` back to `vexa_app_v2`, and `rollback-ownership --snapshot before.json` if ownership must revert (rehearsal R5). Not undone by rollback: the new roles and grants (harmless unused) and rows written meanwhile (the same rows).

Not in Stage 1 (parked, tracked): the observability database superuser, the public proxy and TLS posture, demoting or deleting `vexa_app_v2` (a later, separately approved step).

## 11. Stage 2 outline (does not gate cutover)

Control-plane tables to `SELECT` only (`connector_definitions`, `tax_regimes`, `connector_tenant_entitlements`); append-only tables to `SELECT` plus `INSERT` where lifecycle proves immutability (`audit_logs`, `account_consent_events`, `kpi_metric_events`, `approval_comments`, `connector_mapping_events`); narrow `PUBLIC` database, schema, function and enum privileges (record D-012, D-017); expand the lane; decide RLS or a documented exemption for `AuthIdentity`, `WorkspaceDirectory`, `api_access_keys`, `stripe_webhook_events` (record D-020). Static search alone never proves a table is read-only for the runtime; the lane does.

## 12. Risks and open items

- Class A and A2 jobs fail silently under RLS; mitigation is positive-result assertions, mutation tests and the lane.
- Dashboards by iteration may cost more than one aggregate; measured in 7.7; the fallback is an operator script on `vexa_reporter`, never a runtime bypass.
- Branch protection is not enforced on the current plan, so required checks are convention until decided.
- Secret-to-role mapping for backups and operator workflows is unknown until read by a person.
- This design is not certification of tenant isolation; the post-cutover probe and the section 20 exit criteria of the evidence record are.
