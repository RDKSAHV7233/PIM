# SEC-DB-RLS-001 7.9b: opt-in backup identity and a real restore test

Date: 2026-10-07
Baseline: `origin/main` at `b98da256` (7.9a merged)
Issue: #1189. Design: `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 8. Identity model: #1198, #1217.
Type: **tooling and rehearsal. No production access, no role, grant, ownership, RLS or credential change, no application change.** Nothing happens until a person creates the backup credential and stores it where this section says.

## 1. What changed

| Piece | Before | After |
|---|---|---|
| `.github/workflows/backup-r2-daily.yml` | dumps with the `STAGING_DATABASE_URL_DIRECT` secret | **unchanged by default.** `DATABASE_URL_DIRECT` resolves to `STAGING_BACKUP_DATABASE_URL` when that secret is set, otherwise to the existing secret. The same condition sets `BACKUP_EXPECT_ROLE=vexa_backup` |
| `scripts/r2-backup-run.cjs` | dumps whatever it is connected as | when `BACKUP_EXPECT_ROLE` is set, reads `current_user` and its attributes **before the R2 client is built and before the dump**, and fails the job unless the role is exactly the expected one, not a superuser, and BYPASSRLS. Unset = no check = the old behaviour. A failure fails the backup job, so the existing failure alert fires |
| `scripts/r2-restore-test.cjs` (new) | none | restores the newest backup in R2 into a throwaway local database with the runbook's own procedure (`gunzip \| psql`) and checks what came back (section 3) |
| `.github/workflows/restore-test-r2.yml` (new) | none | manual only (`workflow_dispatch`). A `postgres:18` service container that exists for the job, R2 secrets only, no production database variable |
| `docs/runbooks/backup-restore.md` | | new "Restore test" subsection; one wrong table name in the check queries replaced |
| `scripts/validate-ops-backup-alert-path.cjs` (+test) | alert path pinned | also pins the backup credential mapping, and forbids the observability backup workflow from referencing the main backup credential |
| `scripts/db-identity/rehearse.cjs` | 125 checks | 138 checks: stage R7c (section 4) |

### Two deviations from the plan text, stated plainly
1. **`backup-r2-daily-observability.yml` is not changed.** It backs up a different database (the observability Postgres), which is not part of the I1 identity model. Giving it `vexa_backup` would be wrong, and the validator now fails if that workflow ever references the main backup credential.
2. **`scripts/db-restore.sh` cannot restore these backups.** It expects a custom-format archive for `pg_restore`; the backup job writes plain SQL (`pg_dump --format=plain`), which is what the runbook's `gunzip | psql` path restores. The restore test therefore uses the runbook procedure, and the runbook now says so. Reusing `db-restore.sh` would have tested a different format from the one that is stored.

## 2. Activation (human steps, none of them done here)

1. At the cutover, an administrator creates the five roles and applies the grants (`create-roles`, `apply-grants`; the production procedure is the cutover design, 7.11).
2. A person creates the `vexa_backup` credential and stores it as the GitHub secret `STAGING_BACKUP_DATABASE_URL` in the `staging` environment. From the next run the dump is taken as that role and checked first.
3. A person runs the **R2 Backup Restore Test** workflow by hand (and again after any backup change). It is part of the cutover checklist (Sprint 9 precondition: a real restore test from an R2 backup into a scratch database).
4. Until step 2, nothing changes: the existing secret is used and no identity is asserted.

## 3. What the restore test checks

Nine checks over the restored scratch database, reported as counts and verdicts only: no row values, no URL; a failed restore is reported as its SQLSTATE code.

- the newest object is valid and not older than the age limit;
- psql exited 0 under `ON_ERROR_STOP` and `--single-transaction`;
- pg_dump's completion trailer was seen in the stream (a truncated file cannot pass);
- no restored table is outside the known set, and no more than 10% of the known set is missing;
- `_prisma_migrations` is present with no unfinished migration;
- `ai_platform_controls` has exactly one row;
- `connector_definitions` has at least the expected count;
- row level security is back: enough RLS tables and at least one policy.

The target must be local (`localhost`, `127.0.0.1`, `::1`); a remote target is refused before anything runs. The script reads no production database variable.

## 4. Evidence

- **`r2-backup-run.test.cjs`**, 14 tests: the pure identity verdict (role mismatch, superuser, no BYPASSRLS, unreadable role, skipped when unset), the psql output parser, and static pins that the check precedes the R2 client and the dump and that a failed verdict throws.
- **`r2-restore-test.test.cjs`**, 15 tests: newest-object choice, age, the local-target guard, each verdict in `evaluateRestore`, the trailer tracker, the psql flags, SQLSTATE-only reporting, and workflow pins (manual only, R2 secrets only, no production secret, same major version as the server, throwaway container).
- **Rehearsal on real PostgreSQL, 138 of 138 on 16 and on 18** (was 125). New stage R7c: a plain-SQL gzip dump taken as `vexa_backup`, restored with `gunzip | psql` into a fresh database; the restore-test verdicts pass on the restore and fail on a truncated file, a failed restore and a restore without policies; policy counts equal between source and restore; the identity statement is accepted for `vexa_backup` and refused for runtime, reporter, ops, migrator and a superuser.
- **Mutation check: 30 of 30 caught.** Runner identity (8): expected role ignored, superuser accepted, BYPASSRLS not required, any role name accepted, unreadable role passes, loose parsing, a failed check not failing the job, the check running after the R2 client. Restore test (15): oldest picked, age ignored, failed psql passing, trailer ignored, unknown tables accepted, missing-table allowance widened, unfinished migration accepted, control row not required, connector definitions not required, RLS not required, remote target allowed, psql message kept, no single transaction, a production variable read, a write added to the facts statement. Restore workflow (4): a database secret passed, a schedule added, a remote target, a different server major version. Backup mapping (3): fallback to the existing secret lost, expectation always on, wrong role named. The original files were restored after each.
- `ci.yml` now runs both test files next to the backup alert path guard.

## 5. Not verified

- Nothing ran against production or against R2: no real backup was restored. The restore-test workflow has never run; the first run is a human step.
- The `STAGING_BACKUP_DATABASE_URL` secret does not exist; the opt-in path is exercised only by tests and the rehearsal, not by a GitHub run.
- Which role the existing `STAGING_DATABASE_URL_DIRECT` secret holds is still unknown (evidence record section 18).
- Reporter and ops wiring is 7.9c.
