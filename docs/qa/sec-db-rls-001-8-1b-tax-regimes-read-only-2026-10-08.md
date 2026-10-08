# SEC-DB-RLS-001 8.1b: tax regimes become read-only for the runtime, and the deploy seed writes as the migrator

Date: 2026-10-08
Baseline: `origin/main` at `b616bea0` (8.1a merged as `5144047b`)
Issue: #1189. Plan: Sprint 8 (Stage 2, progressive hardening). Follows `sec-db-rls-001-8-1a-control-plane-read-only-2026-10-08.md` section 5.
Type: **tooling and rehearsal. No production access, no role, grant, ownership or credential change.** The manifest describes the target `vexa_runtime`; production still runs as a superuser until the (HOLD) cutover, and nothing changes in the deploy until a person stores `STAGING_MIGRATION_DATABASE_URL`.

## 1. Why this was split from 8.1a

`tax_regimes` is a system registry (five rows: IN, GB, US, AE, AU; no row level security by design). The API only reads it (catalog tax-code validation, bulk import). Its one deploy-time writer is `scripts/seed-tax-regimes.cjs`, run by `deploy-staging.yml` with the **same credential the API uses** (`STAGING_DATABASE_URL_DIRECT` / `STAGING_DATABASE_URL`). Narrowing the table to `SELECT` for the runtime without moving that writer would make every deploy after the cutover fail at the seed step. So the writer moves first, in the same change.

## 2. What changed

| Piece | Before | After |
|---|---|---|
| `scripts/seed-tax-regimes.cjs` | connects with `DATABASE_URL_DIRECT`, then `DATABASE_URL` | **unchanged by default.** When `MIGRATION_DATABASE_URL` is set (a blank value is not the opt-in) it connects with that and first verifies the connection is `vexa_migrator` (not a superuser, bypasses RLS); a wrong identity stops the run before any write. The script is now importable (guarded by `require.main`) so its rules are unit-tested |
| `.github/workflows/deploy-staging.yml` "Seed tax regimes" | runtime secrets only | also maps `MIGRATION_DATABASE_URL` from the existing opt-in secret `STAGING_MIGRATION_DATABASE_URL` (empty while unset, so nothing changes). This is the same secret the "Apply migrations" step already uses (7.9a) |
| `scripts/validate-deploy-staging-workflow.cjs` | | pins that mapping (that secret only), the command, and that the seed runs after "Apply migrations" |
| `identity-model.v1.json` | `tax_regimes`: `crud` | **`select`** for the runtime, with its reason in `exceptionsToCrud` |
| `scripts/ci/create-restricted-runtime-role.cjs` | | the regular lane's role narrows `tax_regimes` too and asserts it, so the lane runs the API without write access to it |

No new secret is introduced.

## 3. Evidence that the API never writes the table

Same search as 8.1a, repeated for `tax_regimes`: no typed write (`taxRegime.create/update/upsert/delete`, `Many` forms), no raw SQL write, no nested write in `apps/api/src`. The only writers are `scripts/seed-tax-regimes.cjs` (this PR), and the test-environment seeds `seed-realistic-qa-pack-db.cjs` and `start-playwright-api.cjs`, which connect as an administrator. The reads (`bulk-import.service.ts`, `catalog.service.ts`, through the tenant client) are `findMany` only.

## 4. Verification

- **Rehearsal on real PostgreSQL, 185 of 185 on 16 and on 18** (was 171). New stage R8d runs the **real seed script** with real roles after the ownership transfer:
  - with only the runtime credential, as the deploy step runs it today, the seed **fails with permission denied and writes nothing** (this is the break the change prevents);
  - `MIGRATION_DATABASE_URL` pointing at the runtime, the reporter, ops or the backup role is refused by the identity check and writes nothing;
  - with the migrator the seed succeeds, writes all five regimes, and is idempotent, even with the runtime credential also present; the runtime can read what it seeded;
  - without the opt-in, the original administrator path is unchanged and still seeds;
  - no output contains a password; the seeded data is unchanged afterwards.
  The read-only loop also now covers `tax_regimes` (the runtime can read; insert, update and delete are denied).
- **Probe proof 40 of 40 on 16 and 18** (its runtime counts derive from the manifest).
- `seed-tax-regimes.test.cjs` (5 tests), `db-identity/lib.test.cjs`, the deploy-workflow validator, the lane guard, the call-site ratchet and the 7.9a runner tests pass.
- **Mutation check: 12 of 12 caught**, with an unmutated control that passes against the same database: seed rules (migration value ignored, identity check removed, wrong role named, check run without the opt-in, blank value counted as opt-in); workflow (mapping removed, runtime secret mapped); manifest (`tax_regimes` back to `crud`, reason removed); the lane's role script not narrowing it; and, only catchable on a real database, the seed's identity check removed and the manifest un-narrowed, both through the rehearsal.
- The restricted-role lane in CI is the end-to-end proof that the API runs without the writes.

## 5. Activation and what stays open

- Activation is the same human step as 7.9a: store the `vexa_migrator` credential as the GitHub secret `STAGING_MIGRATION_DATABASE_URL`. Until then the seed runs as before. After the cutover the seed must not be left on the runtime credential; the cutover design (7.11, section 5) already lists this workflow.
- `docs/checklists/ops-unblock-staging.md` still describes running the seed by hand with `DATABASE_URL`. After the cutover a manual run needs `MIGRATION_DATABASE_URL`; the script now says so in its header.
- This file edits a workflow, which is a required-team file, so the PR needs the `cto-required-team-approved` label from a person.
- Not verified: nothing ran against production or against Railway/GitHub settings; the deploy step has not run with the migrator secret.
- Sprint 8 remaining: 8.2 append-only tables, 8.3 `PUBLIC`/schema/function/enum privileges, 8.4 lane expansion and the four non-RLS tenant-keyed tables.
