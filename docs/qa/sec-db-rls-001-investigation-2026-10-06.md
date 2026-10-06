# SEC-DB-RLS-001 Investigation: the production runtime database role is a superuser

Date: 2026-10-06
Baseline: `origin/main` at `b18e5279`
Type: **read-only investigation and decision pack. Nothing here changes production, and nothing in it authorises a production change.** The application is live on a single environment, so every option below is judged by what it could break for real customers first.

## 0. Summary

| | |
|---|---|
| Trigger | The AI dormant proof (#1185) found the deployed application role `vexa_app_v2` is a PostgreSQL **superuser** and **owns** the tables. A superuser bypasses row level security even where it is forced. |
| Severity | Critical defence-in-depth gap. There is **no evidence of a cross-tenant leak**. Tenant isolation in production currently rests only on the application's tenant-scope layer. |
| What the dry run showed | Running the repo's own integration tests under a `NOSUPERUSER NOBYPASSRLS`, non-owner role breaks **product code**, not only tests: connector credential storage fails loudly, tenant provisioning silently skips pricing seed, and at least 10 cross-tenant jobs, billing escalation and the ops dashboards would silently see only the `default` tenant. |
| Therefore | Revoking superuser directly is unsafe. A staged identity split with a call-site migration, certified in CI under the restricted role, is required. |
| Recommendation | **GO** on read-only evidence gathering (done, section 8) and on building the certification harness. **NO-GO** on any production privilege change until the call-site migration is merged and certified. |
| AI programme | Not invalidated. First live provider call is blocked on this. |

## 1. What is established, and how

Evidence classes: **[repo]** read from the code at the baseline, **[dry-run]** produced locally against a PostgreSQL 16 built from all 112 migrations, **[prod-read]** read-only production probe already recorded in #1185, **[not yet established]**.

### 1.1 Production identity [prod-read]
- The API connects as `vexa_app_v2`: superuser = true, BYPASSRLS = false, owns the AI tables, `row_security = on`.
- All three API database variables resolve to the Postgres service's **public TCP proxy**, not its private network name. A superuser credential is therefore reachable over a public endpoint.
- The `Postgres` service's own superuser credential **failed authentication** through its public URL. The app's superuser is currently the only working administrative path.
- A second database service (`Postgres-MSwk`) has no AI tables and backs the Error Authority (observability) data.

### 1.2 Schema [dry-run on the repo's migrations]
- 76 tables. RLS enabled on 63, **forced on 53**. 66 policies, all keyed on `app.tenant_key` (3 distinct predicates, the third being the AI maintenance marker).
- **RLS enabled but not forced (10):** `connector_credentials`, `connector_installations`, `connector_submissions`, `connector_webhook_events`, `connector_mapping_events`, `connector_mapping_versions`, `PlanUsage`, `TenantPlanProfile`, `AccessScopeAssignment`, `ConnectorPermission`. Today the owner bypasses these anyway; with a non-owner runtime they become enforced, and **`connector_credentials` (encrypted tenant secrets) is the one that matters most**.
- **Tenant-keyed tables with no RLS at all (4):** `AuthIdentity` (password hashes), `api_access_keys`, `WorkspaceDirectory`, `stripe_webhook_events`. These are deliberate pre-tenant or platform tables, but `AuthIdentity` and `api_access_keys` hold the most sensitive data and rely on application filtering **whatever role is used**.
- No sequences, no identity columns, no views, one trigger and its function, only the `plpgsql` extension, 31 enum types. **Runtime privileges are therefore simple**: table-level `SELECT, INSERT, UPDATE, DELETE`, no sequence grants.

### 1.3 Code: the tenant client and the direct client [repo]
- `PrismaService.tenant(key)` sets `app.tenant_key` on the connection and works under RLS. Its fallback with no context is the **`default` tenant**, so "no tenant context" means "scoped to default", not "blocked".
- `PrismaDirectService` has **no tenant context**. 34 files use it; **31 touch RLS-protected models**.

| Class | What it does | Under a non-bypass role | Files (examples) |
|---|---|---|---|
| A. cross-tenant discovery or aggregation | sweepers, reconciliation, heartbeats, ops dashboards, billing rollups | **silently sees only `default`**: returns empty, no error | bulk-edit and bulk-import stale recovery, connector webhook lease sweeper, connector heartbeat, WooCommerce reconciliation, export-job reconciliation, media integrity, `internal-ops` alerts and summary, `plan-usage` |
| A2. cross-tenant jobs that use `tenant()` with no argument | billing enforcement | **silently default tenant only** | `grace-period-escalation`, `commercial-reminders` |
| B. tenant known, direct client used anyway | credential and connector writes, media | **writes fail loudly** (RLS violation); reads return empty | `credential-encryption.service` and ~14 connector classes (`connectorCredential`), WooCommerce services, `media.service`, parts of `commercial-requests` and `tenant-directory` |
| C. pre-tenant bootstrap | login and workspace lookup | mostly unscoped tables (works); some RLS tables via direct client | `auth.service` (mostly `tenant(tenantId)`, two direct uses), `tenant-directory` |

Class B is mechanically fixable (use `tenant(tenantKey)`). Class A needs a design decision per job (tenant iteration over the authoritative directory, or a SELECT-only maintenance path like the AI one). Class A2 and the ops dashboards are the dangerous ones because the failure is silent.

### 1.4 Operations [repo]
- **Migrations run in Railway's `preDeployCommand` with the service's own credential**, and also in the deploy pipeline from a GitHub secret. Railway has no per-phase variables, so a separate migrator credential set on the service would also reach the running API.
- **Database credentials are held as GitHub secrets (`STAGING_DATABASE_URL*`, `STAGE3_DATABASE_URL`, `OBSERVABILITY_DATABASE_URL`) and used by at least 7 workflows:** deploy (migrations, tax seed, smoke-identity password reset, auth hash coverage, rollback snapshot), daily backup (`pg_dump`), lookup smoke, the controlled-mutation coverage run, media-integrity report, SKU backfill and audit. Whether those secrets are the same superuser credential is **not yet established**.
- Error Authority has its own database and pipeline (same questions apply).

### 1.5 CI [repo]
`backend-tests` connects as the `postgres` superuser (the service container), and `verify-tenant-rls` only checks that policies exist. **No existing CI step exercises RLS as an enforced role.** The only restricted-role runs are a local WooCommerce sandbox proof (which granted all tables) and the 004b-i AI test.

## 2. Empirical dry run [dry-run]

26 representative integration tests (auth, billing, bulk, connectors, credentials, audit, dashboard, issue inbox, AI) were run twice against the same database: once as the superuser and once as a `NOSUPERUSER NOBYPASSRLS` non-owner role holding table-level grants on every table.

| | Failed |
|---|---|
| Superuser (baseline) | 4 of 26, all environmental or pre-existing (credential migration incomplete in a fresh database, planned-stage connector, and similar) |
| Restricted role | 13 of 26: the same 4 plus **9 new** |

The 9 new failures, triaged:

| Cause | Tests | Product or harness |
|---|---|---|
| `credential-encryption.service` upserts the connector credential through the direct client with the tenant's key and no tenant context: **new row violates row-level security policy for `connector_credentials`**. A Shopify install returned HTTP 500 | `connector-idempotency-semantics`, `bulk-publish-runs-installation-filter` | **product** (loud) |
| Tenant provisioning default pricing seed (`market`, `currency`, `priceList` via the direct client) fails and is logged as non-fatal | seen in the `auth-account-privacy` log | **product** (silent) |
| Test seeding with the single URL (`auditLog.createMany`, consent events, `PlanUsage`, `connector_installations` inserts) | `audit-tenant-boundary`, `auth-account-privacy`, `billing-commercial-control`, `connector-webhook-lease-recovery`, `credential-rotation`, `issue-inbox-tenant-boundary` | harness: needs a separate seeding identity |
| A raw `UPDATE` used to soft-delete a product matched **zero rows silently** | `marketplace-worker-failure-visibility` | harness, and a lesson: under RLS a raw UPDATE or DELETE does not error, it quietly does nothing |

13 of the 26 passed under the restricted role, including `rls-isolation`, `bulk-import-tenant-boundary` and `dashboard-tenant-boundary`, which shows the tenant client path itself is sound.

**Backups [dry-run].** `pg_dump` as the restricted role fails ("query would be affected by row-level security policy"). With `--enable-row-security` it **succeeds and silently dumps only the visible rows**. Backups therefore need their own dedicated identity.

**Limits of the dry run:** 26 of 186 integration scripts, synthetic data, one machine. It finds classes of breakage; it cannot prove absence. It cannot see production-only behaviour: production data, the public proxy path, Railway restarts, existing roles, or who else connects.

## 3. Review by lens

These are analyses from each required perspective, **not sign-offs**. Each named team records its own decision (section 7).

**CTO / Architecture.** Separate identities per duty: migrator (owns objects), runtime (CRUD, non-owner), backup (read-only, can read all rows), operations (control tables). Do not demote `vexa_app_v2`; create a new runtime role and swap, so rollback is flipping variables back. Migrations move out of the runtime service. A pre-production environment is needed: production is the only environment, so nothing can be rehearsed against the real configuration.

**Security.** Calibrate the claim. The tenant context is a connection setting: any code that can run arbitrary SQL can set it, so after this work RLS protects against application filter bugs (a missed `WHERE`), not against a compromised application or SQL injection. That is still the correct control to restore, but certification must say exactly that. Separately: the public-proxy exposure of a superuser credential, possible superuser credentials in GitHub secrets (to be confirmed), `connector_credentials` not forced, and `AuthIdentity` and `api_access_keys` having no RLS. Rotate credentials after the swap.

**Backend / DBA.** Runtime grants are table-level CRUD only. Use `ALTER DEFAULT PRIVILEGES` for the migrator's future tables, otherwise every migration becomes a permissions outage. Use explicit grants and keep the control tables tighter: the runtime should hold `SELECT` only on `ai_platform_controls` and `UPDATE` (not `INSERT`) on the platform budget periods, which turns "operators write the kill switch" into a database rule. Class B call sites are mechanical; class A needs a per-job decision.

**SRE / DevOps.** A role swap restarts the single-replica API; schedule it and keep the previous credential live for instant rollback. Migrations moving to the pipeline must fail safe, because merge bursts cancel deploy runs: `preDeploy` becomes verify-only and blocks a start that expects missing schema. Move the API to the private database address. Backups, restores, the observability database and the seven workflows each need an identity decision before any credential is revoked.

**QA / Reliability.** Certification must run the exact production role attributes, in CI, permanently, and must assert **non-empty results** for every cross-tenant job, because the dominant failure is silence. Seed through a separate admin identity. Keep the tenant matrix (own-tenant read, write and update pass; other-tenant read, update and delete blocked; no context sees only `default`).

**Product / PO.** No customer feature is intended to change. Visible risk is limited to a short restart and to any class A job regressing; ops dashboards and billing escalation are the user-visible ones. This is foundational work and should be prioritised ahead of live AI, not folded into it.

**Privacy.** Supports the fix (reduces cross-tenant exposure). Rehearsal must use synthetic data created through the product's own flows, not a production dump: copying tenant data to a developer machine needs its own approval.

**AI governance.** The control plane stays valid and dormant. Dormant adapter work may proceed under separate authorisation; the first live provider request is blocked on this certification, the Security sign-off, the Privacy decisions and provider and model approval.

## 4. Risk register (if we act, and if we do not)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Direct production privilege reduction breaks connector install or credential storage | certain (reproduced) | high, loud | migrate class B first; never flip before the call-site migration is certified |
| Class A jobs silently go blind (billing escalation, sweepers, ops dashboards) | certain (by construction) | high, **silent** | per-job migration plus non-empty-result assertions |
| Backups fail or become silently partial | certain (reproduced) | critical | dedicated backup identity and a restore test before cutover |
| Migration step starts with an unmigrated schema after a cancelled pipeline run | possible | high | verify-only `preDeploy` gate |
| Role swap restart disturbs customers | likely, brief | low to medium | scheduled window, previous credential kept for rollback |
| Superuser credential exposure continues while we plan | present | high | prioritise; private networking and credential separation are the earliest low-risk steps |
| False assurance from "RLS certified" | possible | medium | state the filter-bug-not-compromise scope in the acceptance text |

## 5. Options

| Option | Description | Verdict |
|---|---|---|
| A. `ALTER ROLE vexa_app_v2 NOSUPERUSER` now | one statement | **Reject.** Reproduced breakage; no rollback of the credential itself |
| B. Staged identity split (recommended) | inventory, call-site migration, CI restricted-role gate, new runtime role, swap, rotate | **Recommend** |
| C. Leave as is and compensate with monitoring | detective controls only | Reject as an end state; acceptable only as a short interim |

## 6. Recommended plan, with gates

Each phase ends in a recorded decision. No phase changes production data or privileges until Phase 5.

1. **Read-only production evidence** (needs a person's authorisation and a narrowly scoped read-only probe): role list and attributes, table, schema and object owners, who actually connects (distinct user and application names), what the web service connects as, grants, and whether anything else uses the superuser. Output booleans, counts and names only.
2. **Certification harness** (no production access): a CI step creating the restricted role with explicit grants from the repo, a separate seeding identity, the tenant matrix, and non-empty-result assertions. Initially non-blocking, to measure.
3. **Call-site migration**, one PR per class, each independently releasable: B (tenant client for known tenants, including tenant provisioning), A and A2 (tenant iteration over `WorkspaceDirectory`, or a SELECT-only maintenance policy), the harness fixes, and `connector_credentials` forced.
4. **Pre-production rehearsal** on synthetic data in a separate environment, including backup, restore and a migration run as the migrator.
5. **Production cutover**, scheduled: create `vexa_migrator`, the new runtime role, a backup role and an operator path; move migrations to the pipeline; swap the variables; verify; keep the old credential for rollback until the verification window closes; then rotate it and revoke.
6. Re-run the dormant AI proof and the kill-switch drill under the new identities (the drill's control-row writes move to the operator identity).

**Abort and rollback:** before Phase 5 nothing is live, so abort is free. After the swap, flip the variables back to the previous credential (kept valid), which restores the prior behaviour in one restart.

## 7. Decisions requested

| Owner | Decision |
|---|---|
| CTO / Architecture | identity model; creating a pre-production environment; migrations to the pipeline |
| Security | severity, interim controls, acceptance wording, credential rotation, hardening of `AuthIdentity` and `api_access_keys` |
| Backend / DBA | per-job decision for class A (iteration versus maintenance policy); grant set |
| SRE | cutover window, backup and restore identity, private networking, observability database |
| QA | the certification matrix and the CI gate |
| Privacy | approval for any production-derived data in rehearsal (recommendation: none) |
| PO | priority relative to live AI and the WooCommerce P1 work (this closes F6 there) |

## 8. Production probe results (read-only, 2026-10-06)

Run with `scripts/sec-db-rls-001-probe.cjs` (PR #1190) as the deployed role, inside a READ ONLY transaction. Output is names, counts and booleans only; no row, secret or connection string was printed.

**Main database (the `Postgres` service, PostgreSQL 18, 76 tables).**

| Fact | Result |
|---|---|
| Roles that exist | exactly two: `postgres` (superuser, BYPASSRLS) and `vexa_app_v2` (superuser). No migrator, backup, read-only or runtime role exists |
| Ownership | 63 tables owned by `postgres`, **14 tables owned by `vexa_app_v2`**, plus 1 function and 9 enum types owned by `vexa_app_v2` (22 enum types by `postgres`). Objects created by migrations since the role change belong to `vexa_app_v2`, so two owners must be unified |
| Explicit grants | only the owners' own grants; **no non-owner grants exist** and there are no default privileges, so the runtime grant set must be created from scratch |
| RLS coverage | 63 enabled, 53 forced, the same 10 enabled-but-not-forced tables and the same 4 tenant-keyed tables with no RLS as the repo audit. **Production matches the repo schema, so the dry run is representative** |
| Who is connected | 11 client sessions, all `vexa_app_v2`: 7 named `vexa-pim-api` and 4 with no application name (inferred: the direct client and the advisory-lock client). No other database user was connected at that moment |
| Migrations | 113 applied, 0 unfinished, latest `20261005120000_ai_provider_budget_lifecycle` |
| Server | TLS supported (`ssl = on`), `max_connections = 500`; the client URLs carry no `sslmode`, so client-side TLS use is **not confirmed** |
| Public schema | owned by `pg_database_owner`; PUBLIC cannot create |

**How services connect.**
- The API's `DATABASE_URL`, `DATABASE_URL_DIRECT` and `DATABASE_URL_POOLED` all resolve to `vexa_app_v2` over the **public TCP proxy** (the pooled URL is the same as the direct one: there is no pooler).
- The web service (`App Vexa`) has **no database variables**: the API is the only runtime consumer of the main database.
- The API's `OBSERVABILITY_DATABASE_URL` resolves to `postgres` (superuser) over the **private network**.

**Observability database (`Postgres-MSwk`, PostgreSQL 18).** One role (`postgres`, superuser), 3 tables plus the migrations table, no RLS, no tenant-keyed tables, one session (`vexa-error-authority`), 2 migrations applied. It carries lower tenant risk, but it is also accessed as a superuser.

**Inference worth stating plainly.** Only two roles exist and both are superusers, so **every database credential that works anywhere, including the GitHub secrets used by the migration and backup workflows, is necessarily a superuser credential**. The `Postgres` service's own `postgres` credential failed authentication earlier, so the working administrative path today is `vexa_app_v2` itself.

**Consequences for the plan.**
1. A migrator, a backup, an operator and a runtime role must all be created; none exists.
2. Ownership of the 14 plus 1 plus 9 objects must be unified before the runtime role becomes a non-owner.
3. Grants and default privileges start from zero; no sequence grants are needed.
4. The administrative credential for the main database needs to be repaired or replaced as step 0 (a production write that needs its own approval).
5. Client TLS use, and moving the API to the private address, remain to be confirmed and done.

## 9. Not established yet

Which GitHub secret holds which of the two credentials (the role inventory implies superuser for all), how many of the 186 integration scripts are affected, production data behaviour under a restricted role, and client-side TLS use. Phase 1 production inventory is otherwise complete.
