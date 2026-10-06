# SEC-DB-RLS-001 I1: database identity foundation

Date: 2026-10-06
Baseline: `origin/main` at `5a2c325c`
Issue: #1189. Decision pack: #1188. Call-site classification: #1193. Restricted-role lane: #1195.
Type: **design, tooling and a rehearsal harness. No application change, no production access, no production write.**

## 0. What this is and is not

I1 designs the target database identities and **proves, on a database that reproduces the production ownership split, that production can be moved to them and back**. It changes nothing in production.

| In I1 (this PR) | Not in I1 (needs a separate, explicit go) |
|---|---|
| Role design: migrator, runtime, backup, ops | Switching any `DATABASE_URL` |
| Explicit least-privilege grants manifest | Demoting, altering or deleting `vexa_app_v2` |
| Ownership-transfer and rollback mechanics | Any production ownership transfer |
| Rehearsal harness, PostgreSQL 16 **and 18** | Any production credential creation or rotation |
| CI rehearsal job | Live cutover |
| Verifier that fails CI on an unclassified table | Call-site migration (I2 onward: M1 to M6) |

`vexa_app_v2` is not touched by anything here. The tool refuses every write mode on any host that is not `localhost`, `127.0.0.1` or `::1`, and the rehearsal refuses the same way. No production credential is read or needed.

## 1. The target model

| Identity | Purpose | Attributes | Owns | Table privileges |
|---|---|---|---|---|
| `vexa_migrator` | runs migrations at deploy time only | LOGIN, NOSUPERUSER, **BYPASSRLS**, no CREATEROLE/CREATEDB | every table, enum type and function in `public` | owner; the only role that can CREATE in `public` |
| `vexa_runtime` | the API | LOGIN, NOSUPERUSER, NOBYPASSRLS | nothing | `SELECT INSERT UPDATE DELETE` on each listed table; **`SELECT` only** on `ai_platform_controls`; **`SELECT UPDATE`** on `ai_platform_budget_periods`; nothing on `_prisma_migrations`; no DDL, no TRUNCATE |
| `vexa_backup` | `pg_dump` | LOGIN, NOSUPERUSER, **BYPASSRLS** | nothing | `SELECT` on every table |
| `vexa_ops` | operators on the platform control tables | LOGIN, NOSUPERUSER, NOBYPASSRLS | nothing | `SELECT INSERT UPDATE DELETE` on `ai_platform_controls` and `ai_platform_budget_periods` only |

There is **deliberately no cross-tenant maintenance role**. Known cross-tenant jobs move to tenant iteration, or to the SELECT-only maintenance policy already in the AI control plane, as classified in #1193. A maintenance role is added only when a named job needs it and cannot iterate; the mechanism for adding one is the same manifest, and the verifier would flag a fifth role that appears without a manifest entry.

**Grants are explicit and there are no default privileges.** `packages/db/identity/identity-model.v1.json` lists every table. A table that a migration adds and nobody classifies is unreachable by the runtime (fails closed), and `verify` fails CI until it is classified. The files are:

- `packages/db/identity/identity-model.v1.json`: the manifest (77 runtime tables, plus the `_prisma_migrations` exclusion).
- `packages/db/identity/production-ownership-split.v1.json`: the ownership split observed in production on 2026-10-06 by the read-only probe (names only): 15 tables, 2 functions and 9 enum types owned by `vexa_app_v2`; everything else owned by `postgres`.
- `scripts/db-identity/lib.cjs`: pure logic (plans, evaluation). `scripts/db-identity/tool.cjs`: `snapshot`, `plan-ownership`, `verify` (read-only) and `create-roles`, `apply-ownership`, `rollback-ownership`, `apply-grants` (local only). `scripts/db-identity/rehearse.cjs`: the rehearsal.

## 2. The rehearsal

`node scripts/db-identity/rehearse.cjs` (needs `REHEARSAL_ADMIN_URL`, a local superuser; `REHEARSAL_DOCKER_CONTAINER` runs `pg_dump`/`pg_restore` inside the server container). It runs 88 checks in ten stages:

| Stage | What it proves |
|---|---|
| R1 | Builds the production-like database: all 114 migrations as the database owner, then creates `vexa_app_v2` as a superuser and reassigns exactly the fixture's 15 tables, 2 functions and 9 enum types to it; seeds three tenants and the control rows |
| R2 | The starting state equals the observed production split (and the verifier **fails** on it, so it is not already the target) |
| R3 | Transfer from that state: create roles, ownership transfer in one transaction, explicit grants; the verifier passes; **no data was rewritten** (row counts and content hashes unchanged) |
| R4 | Idempotency: a second run changes nothing (0 ownership statements) |
| R5 | **Rollback** from the before-snapshot restores exactly the 63 + 15 split; `vexa_app_v2` is still a working superuser that can write the control row; data unchanged; forward re-apply works |
| R6 | Runtime: tenant isolation on a forced-RLS table (tenant A, tenant B, default fallback), own-tenant INSERT/UPDATE/DELETE work, cross-tenant INSERT rejected, cross-tenant UPDATE/DELETE match zero rows, cannot turn `row_security` off; no DDL, no TRUNCATE, cannot disable RLS or drop a policy, cannot create roles or `SET ROLE` to the migrator, cannot read `_prisma_migrations`; **cannot write the kill switch**; can move budget counters but not create or delete periods |
| R7 | Backup: sees all tenants (the runtime saw one), cannot write; `pg_dump` as `vexa_backup` succeeds; the dump **restores** into an empty database and matches the source |
| R8 | Ops: can write the kill switch and create/delete budget periods; cannot read, write or create anything else |
| R9 | `prisma migrate deploy` as `vexa_migrator` works on the transferred database; a new table from a migration is unreachable by the runtime until classified; the verifier fails the unclassified table; **a backup taken before the new table is granted fails loudly**; after the manifest is updated the grants apply, the runtime reaches the table still tenant-isolated, and the backup works again |
| R9b | The data-fixing finding below, reproduced |
| R10 | A fresh database migrated **entirely as the non-superuser `vexa_migrator`**: every migration applies, everything is owned by the migrator from the start, the verifier passes |

Result: **88 of 88 on PostgreSQL 16.13 and on PostgreSQL 18.6** (production runs 18). The CI job `db-identity-rehearsal` runs both versions. `pg_dump` and `pg_restore` must exist; a missing tool fails the job.

The rehearsal is discriminating, not decorative: loosening the manifest so the runtime may write the control row produced five failures (the three denial checks, the unchanged-data check and the restore comparison), then the manifest was restored. The pure logic has 25 negative mutations in `lib.test.cjs`, each of which must be detected by a named check.

## 3. Findings the rehearsal produced

**F1. The migrator needs BYPASSRLS (design decision; please confirm).** Every tenant table is `FORCE ROW LEVEL SECURITY`, so even its owner sees only the `default` tenant unless `app.tenant_key` is set. Data-fixing migrations already exist (`20260816000001_delete_orphaned_media_assets` deletes from the forced-RLS `media_assets`; `20260610000001` updates `PlanLimits`). R9b reproduces it: the same `UPDATE` reaches 3 tenants as the migrator with BYPASSRLS and **1 row, silently**, without it. NOSUPERUSER NOBYPASSRLS on the *owner* is cosmetic anyway, because an owner can `DROP POLICY` or `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`. I therefore gave the migrator BYPASSRLS. The runtime path never holds that credential. If you prefer NOBYPASSRLS, the cost is that every future data migration must set the tenant context per tenant, and a forgotten one fails silently.

**F2. No migration needs a superuser.** R10 applies all 114 migrations as a plain `NOSUPERUSER` role. This was not known before and is the precondition for taking superuser away from the deploy path.

**F3. Backup coupling is fail-loud, which is intended, but it is a deploy ordering rule.** With explicit grants, a table added by a migration is not readable by `vexa_backup` until `apply-grants` runs; `pg_dump` then fails with a permission error (R9). That is better than silently omitting the table, but it means **`apply-grants` must run immediately after `migrate deploy` in the deploy command**, and that the backup failure alert path must be live. The alert path is fixed separately in #1197; humans still have to set `API_INTERNAL_BASE_URL` and `INTERNAL_OPS_API_KEY`.

**F4. `prisma migrate deploy` works unchanged as the owner role** on the transferred database, including the advisory lock and the `_prisma_migrations` read and write.

**F5. The ownership transfer is metadata only.** Hashes of the seeded tables are identical before and after, and after rollback.

## 4. Rollback design

- **Ownership:** `snapshot --out before.json` records the owner of every table, enum type and function (with function identity arguments). `rollback-ownership --snapshot before.json` restores **each object to its own recorded owner** (not to one owner), in one transaction, and reports whether the result equals the snapshot. R5 proves it, including that the original owner still functions afterwards.
- **Credentials:** because `vexa_app_v2` is never altered, a credential rollback is "point `DATABASE_URL` back". Nothing in the model requires deleting the old role until a later, separately approved step, after certification.
- **What rollback does not undo:** the new roles and their grants stay (harmless without a connection string using them), and data written by the runtime role after cutover stays (it is the same rows). Both are intended.
- **Rows:** nothing in I1 rewrites rows.

## 5. Cutover prerequisites (not executed here)

Programme gates, as directed on 2026-10-06:

1. **Blocked until GitHub plan supports branch protection or rulesets**, `restricted-role-lane` and the critical CI checks are *required*, and bypass permissions are tightly controlled. I1 and I2 proceed under convention and manual discipline only.
2. The deploy command would become: `migrate deploy` as `vexa_migrator`, then `apply-grants`, then the app starts as `vexa_runtime`. Today `preDeployCommand` runs migrations with the runtime credential; separating them needs two credentials in Railway, which is a human action.
3. The cross-tenant jobs and the call sites in #1193 (M1 to M6) must be migrated, or the runtime role would silently see only the `default` tenant in those jobs. The restricted-role lane is the safety net.
4. A pre-production environment (or a copy) to rehearse the real transfer with production-shaped data.

## 6. Limits

- The rehearsal reproduces the *ownership split* and the *schema*, not production data volumes, extensions, Railway networking or the real passwords. Passwords are rehearsal-only constants that exist only in the throwaway databases.
- The runtime proofs use one forced-RLS table and the platform control tables, not the whole API. Running the API's integration tests as `vexa_runtime` is what the restricted-role lane (#1195) does with its own role; aligning that lane to `vexa_runtime` is a small follow-up, not done here.
- Grants are table-level. There are no sequences or identity columns in the schema today; the verifier would need extending if one is added (a migration adding one would not be covered by the grants manifest).
- The fixture records names observed on 2026-10-06. If production changes before cutover, re-run the extended probe and compare.
- This is design and rehearsal evidence. It is not certification of tenant isolation.
