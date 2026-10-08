# SEC-DB-RLS-001 7.11: restricted-runtime cutover design

Date: 2026-10-08
Baseline: `origin/main` at `4cbbdf5d`
Issue: #1189. Supersedes section 10 of `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` (that section stays as the summary; this document is the detailed design).
Type: **documentation only. A decision aid, not an authorization.** No production access was used. It creates no approval, sign-off or acceptance, and it does not change the owner's posture of 2026-10-08 recorded in `docs/execution/PROGRAMME_RECONCILIATION_2026-10-08.md`: **restricted-runtime production cutover is HOLD (CUTOVER_BLOCKED).** Nothing here is to be executed until the blockers in section 3 are closed and a named human authorizes the cutover.

## 1. What the cutover is, and is not

**Objective, unchanged and not overclaimed:** the ordinary Vexa runtime identity must be unable to bypass database tenant isolation accidentally or implicitly; cross-tenant access must require an explicit, separately governed privileged path.

**Strategy (owner decision, 2026-10-08):** do **not** demote or modify `vexa_app_v2` in place. Create a new restricted credential, cut the application over to it, observe, and roll back by switching the credential back. `vexa_app_v2` stays exactly as it is for the whole window.

**What it does not prove.** Tenant context is client-supplied (`app.tenant_key`). Row level security stops accidental and implicit cross-tenant access by an ordinary connection; it does not stop a fully compromised API process, which can set any tenant. This design is not a certification of tenant isolation. The closing evidence is the post-cutover probe and the exit criteria in section 20 of the evidence record.

## 2. Findings from reading the deploy surface (new, repository facts)

These change how the cutover and the rollback must be done. Each is checked against the files named; none was checked against Railway or GitHub settings, which no agent session can read.

**F1. Every deploy rewrites the API's database variables from GitHub secrets.** `.github/workflows/deploy-staging.yml` passes `DATABASE_URL_POOLED` (from `STAGING_DATABASE_URL`) and `DATABASE_URL_DIRECT` (from `STAGING_DATABASE_URL_DIRECT`) to `scripts/railway-deploy.cjs`, and `resolveApiDatabaseVariables` (line 767) writes both into the API service's Railway variables on each deploy. Consequences:
- Switching the Railway variables by hand is **not durable**: the next deploy (any push to `main` that deploys) puts the GitHub secret values back.
- A credential-switch rollback has the same property: rolling back in Railway alone is undone by the next deploy.
- The sync is best effort: if it fails, `setApiServiceDatabaseVariables` warns and the deploy proceeds, leaving whatever Railway already held. So after the switch, confirm in Railway that the variables really changed (a person with Railway access; no agent can read them), do not infer it from a green deploy.
- The durable switch, forward and back, is the two GitHub secrets. The cutover and the rollback both change **GitHub secrets first, then redeploy**, or change both places in the same step. No deploy may run during the window unless the secrets already hold the intended values.

**F2. The API requires both variables.** `apps/api/src/common/env-validation.ts` requires `DATABASE_URL_POOLED` and `DATABASE_URL_DIRECT`. `advisory-lock.ts` uses `DATABASE_URL_DIRECT` (scheduler locks need a session-stable connection). Both must therefore point at `vexa_runtime`; there is no variable that could be left on the old role without leaving the old role in use for locking.

**F3. The Railway pre-deploy command fails after the ownership transfer.** `apps/api/railway.toml` runs `node scripts/prisma-migrate-deploy.cjs` as the pre-deploy command with the runtime variables. After the transfer the runtime cannot read `_prisma_migrations`, so `prisma migrate deploy` fails and the deploy fails (rehearsal R9c proves it). The GitHub workflow already applies migrations **before** it deploys, as the migrator when `STAGING_MIGRATION_DATABASE_URL` is set (7.9a). The end state is: migrations only in the workflow, and the Railway pre-deploy removed. That is a repository change (`railway.toml`) that must merge **before** the credential switch, and it is safe to merge early because the workflow already migrates first (a pre-deploy that finds nothing to apply is a no-op).

**F4. The migrator credential must never be an API-service variable.** Railway shares service variables between the pre-deploy command and the running process. `MIGRATION_DATABASE_URL` exists only as the GitHub secret `STAGING_MIGRATION_DATABASE_URL`. The runner refuses the configuration inside a Railway service (7.9a).

**F5. Eight workflows touch a database credential directly**, not only the API. Each needs a decision (table in section 5):
`deploy-staging.yml` (migrations, seed tax regimes, smoke-identity password reset, password-hash coverage, the Railway sync), `lookup-smoke-workspace.yml`, `staging-account-export-acceptance.yml`, `staging-media-acceptance.yml`, `staging-resend-delivery-check.yml`, `res-02-connector-export-coverage.yml`, the two backup workflows, and the three operator workflows (7.9c). The staging acceptance workflows run `reset-smoke-identity-password.cjs` against the database with the same secrets the runtime uses.

**F6. The web service holds no database credential in application code** (the only `DATABASE_URL` references under `apps/web` are end-to-end test files). The web service is therefore outside the credential switch. *Unverified:* whether the Railway web service has a database variable set that nothing reads.

**F7. The `STAGE3_DATABASE_URL` fallback is still in three workflows.** 7.9c left it as the fallback so nothing changes before the dedicated credentials exist. It is a superuser-class credential in the step environment of the report and backfill workflows until a follow-up removes it (section 8).

## 3. Preconditions (all must be true; status as of this document)

| # | Precondition | Owner | Status today |
|---|---|---|---|
| P1 | Remaining class-A jobs migrated to tenant iteration (ten at the 2026-10-08 index; the other stream is working through them: #1243, #1245, #1246, #1247 merged) | Platform | **OPEN** |
| P2 | Class C resolved: `auth.service` review, `commercial-requests` (D2), `stripe.service` (D3), `tenant-directory` split, `media.service` unsigned branch | Platform + owner | **OPEN** |
| P3 | M1c: the optional direct-client fallback removed from 15 connectors and 3 services | Platform | **OPEN** |
| P4 | 7.2a deployed **and** runtime-verified (sweeper and counter audit produce a positive per-tenant result in production), then 7.2b merged and deployed, probe shows no `ai_maintenance_read_*` policy | Human + Platform | **OPEN** (runtime verification not done) |
| P5 | Final restricted-runtime rehearsal passes on PG16 and PG18 with the API and workers running as the real `vexa_runtime` (7.10R, #1244) | Platform | **IN PROGRESS**: #1244 is a draft; at head `eb92baf5` both `db-identity-rehearsal-v2` lanes fail with validated redacted artifacts, and the other CI jobs are green. The failures are real restricted-runtime failures, not infrastructure, and are the other stream's slice |
| P6 | A real restore: the newest R2 backup restored into a scratch database with the 7.9b workflow (`restore-test-r2.yml`), all nine checks pass | SRE | **OPEN** (workflow never run) |
| P7 | Rollback rehearsal passes (rehearsal R5 covers ownership rollback; the credential rollback is section 7) | SRE | partly rehearsed |
| P8 | Credentials created and stored: `vexa_runtime`, `vexa_migrator`, `vexa_backup`; `vexa_reporter` and `vexa_ops` as required | SRE | **OPEN** (none exists; no `MIGRATION_`, `BACKUP_`, `REPORTER_`, `OPS_DATABASE_URL` secret in GitHub as of 2026-10-07) |
| P9 | Backup failure alert path dry run verified (#1197, #1201 fixed it; a dry run on the real endpoint is a human step) | SRE | **OPEN** |
| P10 | Branch protection, or an owner-accepted equivalent (upgrade, an externally enforced merge control, or an explicit Security + CTO + SRE risk acceptance) | Owner | **OPEN** (`protected=false`; rulesets need a plan upgrade) |
| P11 | Role of each existing secret known: what `STAGING_DATABASE_URL`, `STAGING_DATABASE_URL_DIRECT`, `STAGE3_DATABASE_URL` and the Railway variables actually hold (evidence record section 18) | SRE | **OPEN** |
| P12 | Security and SRE sign-off by name and date | Security, SRE | **NOT RECORDED** |

## 4. Credential and variable matrix (target state)

| Identity | Stored as | Consumed by | Never in |
|---|---|---|---|
| `vexa_runtime` (NOBYPASSRLS, owns nothing) | GitHub `STAGING_DATABASE_URL` and `STAGING_DATABASE_URL_DIRECT` (two secrets, one role); Railway API `DATABASE_URL_POOLED` / `DATABASE_URL_DIRECT` (synced from them by the deploy, F1) | the API process, workers | the migrator, backup, reporter or ops workflows |
| `vexa_migrator` (BYPASSRLS, owns every object) | GitHub `STAGING_MIGRATION_DATABASE_URL` only | the deploy workflow's migration step (migrate, then strict `apply-grants`) | **any Railway variable (F4)** |
| `vexa_backup` (BYPASSRLS, read-only) | GitHub `STAGING_BACKUP_DATABASE_URL` | `backup-r2-daily.yml` (identity checked before the dump) | the observability backup, the API |
| `vexa_reporter` (BYPASSRLS, read-only on four tables) | GitHub `PRODUCTION_REPORTER_DATABASE_URL` (environment `production`) | audit and media reports | the API, Railway |
| `vexa_ops` (NOBYPASSRLS, narrow DML + directory SELECT) | GitHub `PRODUCTION_OPS_DATABASE_URL` (environment `production`) | the sellable-SKU backfill, platform controls | the API, Railway |
| `vexa_app_v2` (superuser, today's runtime) | unchanged | nothing after the switch, **but kept valid and untouched through the observation window** | demoted or edited in place: not in this cutover |

No credential, URL or password is placed in this repository, in a PR, or in a log. Credentials are created by a person, stored by a person, and read by scripts only through the variables above.

## 5. The eight direct-credential workflows: decision per workflow

| Workflow / step | Today | At cutover | Notes |
|---|---|---|---|
| `deploy-staging.yml` apply migrations | direct/pooled secrets | `MIGRATION_DATABASE_URL` set: migrate + strict grants as `vexa_migrator` | 7.9a; the runtime secrets are then not used for migrations |
| `deploy-staging.yml` Railway variable sync | writes pooled/direct from the two secrets | unchanged, but the two secrets now hold `vexa_runtime` (F1) | the switch **is** changing these two secrets |
| `deploy-staging.yml` seed tax regimes, smoke-identity password reset, password-hash coverage | runtime secrets | runs as `vexa_runtime`; **each must be exercised in the rehearsal** | `tax_regimes` is currently `crud` for the runtime; `reset-smoke-identity-password` writes `AuthIdentity` (crud). Whether they need tenant context is UNVERIFIED and is a P5 item |
| `lookup-smoke-workspace.yml` | runtime secrets | as `vexa_runtime`; reads the tenant directory (crud) | verify in rehearsal |
| `staging-account-export-acceptance`, `staging-media-acceptance`, `staging-resend-delivery-check` | runtime secrets (password sync step) | as `vexa_runtime` | same script as above |
| `res-02-connector-export-coverage.yml` | runtime secrets + Shopify controlled mutation | as `vexa_runtime`; **do not run during the window** | it mutates a real connector; keep it out of the window |
| `backup-r2-daily.yml` | `STAGING_DATABASE_URL_DIRECT` | `STAGING_BACKUP_DATABASE_URL` set: `vexa_backup`, identity checked | 7.9b |
| `backup-r2-daily-observability.yml` | `OBSERVABILITY_DATABASE_URL` | unchanged: a different database outside the model (parked item: observability superuser) | |
| Report / backfill workflows | `STAGE3_DATABASE_URL` | dedicated reporter/ops secrets; fallback removed afterwards (section 8) | 7.9c |

## 6. Sequence

Every step names who acts, what is verified, and when to stop. "Agent" steps use only read-only production access or local tools; every production change is a **human** step.

**Phase 0: dress rehearsal on restored production data (before the window; human + agent).**
Restore the newest backup into a scratch database (P6). On that copy run, with local tooling only: `snapshot`, `plan-ownership` (review), `create-roles`, `apply-ownership`, `apply-grants`, `verify`, then the application's own test suites and the restricted-role lane as `vexa_runtime`, then the three operator scripts with the dedicated credentials. This is the closest available proof that the real data, not the fixture, survives the sequence. Record counts only. *This phase is new relative to the earlier design; it exists because the rehearsal fixture has 15 tables of synthetic rows, and production has the real schema and real tenants.*

**Phase 1: repository changes that are safe before the switch (agent, normal PRs).**
1. Remove the Railway pre-deploy command from `apps/api/railway.toml` (F3). Safe now: the workflow migrates first.
2. Nothing else may remain that requires the runtime to read `_prisma_migrations` or to own an object. The rehearsal asserts this.

**Phase 2: before-state (human + agent, read-only).**
3. Re-run the production probe (`sec-db-rls-001-probe.cjs`) and confirm the ownership still equals the fixture and that the identity list is still `postgres` and `vexa_app_v2` plus whatever was created since.
4. Take `snapshot --out before.json` and a backup under the current identity; restore it to a scratch database (P6 again, on the exact pre-cutover state). Keep both artifacts.

**Phase 3: identities and grants (human, in a maintenance window).**
5. SRE creates the five credentials and stores them as the GitHub secrets in section 4. `vexa_runtime`'s secrets are created **under new names** (for example `STAGING_DATABASE_URL_RESTRICTED`, `STAGING_DATABASE_URL_DIRECT_RESTRICTED`) so `vexa_app_v2`'s values stay intact for rollback (section 7).
6. `create-roles`, then `plan-ownership` (reviewed by a second person), then `apply-ownership` (one transaction, metadata only), then `apply-grants`, then `verify`. These write modes refuse non-local hosts today; running them in production is a separately authorized change to that guard or a manual run by an administrator. **That authorization is itself a gate**, not assumed here.
7. Run the probe as each candidate role and compare with the rehearsal expectations (NOSUPERUSER, NOBYPASSRLS for runtime, owns nothing).

**Phase 4: switch (human).**
8. Set `STAGING_MIGRATION_DATABASE_URL` (migrations now run as the migrator in the workflow).
9. Change the two runtime GitHub secrets to the `vexa_runtime` values and trigger one deploy. Do not edit Railway by hand (F1).
10. Verify immediately: readiness (`/api/v1/health/ready`); a login; workers produce **non-empty per-tenant results** (the 7.2a/P4 evidence pattern); a tenant-isolation smoke (a second tenant cannot read the first); one write through each major surface; the scheduler lock still works (advisory lock on `DATABASE_URL_DIRECT`).
11. Run the backup workflow and the restore-test workflow once; run the reporter and ops dry runs.

**Phase 5: observation (human + agent).**
12. A defined window, proposed 7 days (owner to decide; section 9). `vexa_app_v2` is untouched and valid. Daily: error rate, 503/pool-timeout rate against the pre-cutover baseline (the O-1 / INC-93-S9 observations are unresolved and must not be mistaken for cutover regressions: record the baseline first), per-tenant job counts, backup success, alert delivery. **No deploy during the window unless the secrets already hold the intended values (F1).**

**Phase 6: close (human).**
13. Run the production probe under the deployed role; update the evidence record; Security and SRE sign off. Only then are the follow-ups in section 8 opened. SEC-DB-RLS-001 closes only on the section 20 exit criteria of the evidence record, including no setting-activated cross-tenant path.

## 7. Abort criteria and rollback

**Abort and roll back immediately if** any of: a tenant-isolation check fails; a cross-tenant job returns empty where non-empty is expected; a migration fails; a backup or restore fails; readiness or error rate regresses beyond the recorded baseline; a worker stops producing results; an unexpected permission error appears in logs for the runtime role.

**Rollback A, credential (the normal one; minutes).** In this order:
1. Set the two GitHub runtime secrets back to the `vexa_app_v2` values (kept under their original names untouched, or restored from the `_RESTRICTED` pair, section 6 step 5).
2. Redeploy (the sync writes the old values into Railway, F1), or set the two Railway variables in the same step.
3. Verify readiness and the same smoke list.
Because ownership may already have moved to `vexa_migrator`, `vexa_app_v2` (a superuser) still works: superusers do not need ownership. This is why the superuser is kept untouched and why the strategy works.

**Rollback B, ownership (only if it must revert).** `rollback-ownership --snapshot before.json` (rehearsal R5). Not needed for a credential rollback.

**Not undone by rollback:** the new roles and grants (harmless, unused), rows written during the window (the same rows either way), and the removed Railway pre-deploy (the workflow migrates). Say so in the change record.

## 8. Follow-ups after a successful window (separate PRs, each reviewed)

1. Remove the `STAGE3_DATABASE_URL` fallback from the three operator workflows and the matching pin in their validators (F7).
2. Make the backup, reporter and ops secrets required (remove the `||` fallback in `backup-r2-daily.yml`, which today falls back to the superuser-class secret).
3. Tighten the grants (Sprint 8 / Stage 2). Not a cutover prerequisite unless Security or SRE name a specific item as blocking.
4. A later, separately approved decision about demoting or retiring `vexa_app_v2`.
5. Parked, tracked: observability database superuser, public proxy and TLS posture.

## 9. Decisions needed from the owner

| # | Decision | Recommendation |
|---|---|---|
| D-C1 | Observation window length | 7 days |
| D-C2 | Who may run the production write modes of the identity tool, and how the "local host only" guard is lifted for that run (a one-time reviewed flag, or administrator SQL generated by `plan-ownership`) | administrator runs the reviewed `plan-ownership` output; no change to the guard |
| D-C3 | Whether Phase 0 (dress rehearsal on restored data) is mandatory | yes: it is the only proof on real data |
| D-C4 | Whether `vexa_reporter` / `vexa_ops` are provisioned at cutover or later (the fallback keeps the operator workflows working on the old credential) | later; not on the critical path |
| D-C5 | Branch protection disposition (P10) | needed before cutover; owner's plan decision |
| D-C6 | Maintenance window timing and communication | owner / SRE |

## 10. Sign-offs

Blank on purpose. This document records none.

| Role | Name | Date | Decision |
|---|---|---|---|
| Security | | | |
| SRE | | | |
| CTO | | | |
| QA / Reliability | | | |

## 11. Not verified

- Nothing here was run against production, Railway or GitHub settings. Findings F1 to F5 and F7 are read from repository files; F6's unverified part is stated there.
- What any existing secret holds (P11), and what the Railway variables hold, is unknown.
- Whether the post-transfer `seed-tax-regimes`, smoke-identity and coverage scripts run cleanly as `vexa_runtime` is not rehearsed; it belongs to P5.
- The O-1 (503) behaviour is unresolved and could be confused with a cutover regression; the baseline in Phase 5 exists for that reason.
- Phase 3 step 6 assumes the ownership and grants can be applied in a maintenance window without the application running against the old owner set; the rehearsal proves metadata-only change and unchanged data hashes, not production lock duration.
