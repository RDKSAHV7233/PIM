# SEC-DB-RLS-001: the restricted-role CI lane

Date: 2026-10-06
Baseline: `origin/main` at `731afa94`
Issue: #1189. Decision pack: #1188. Call-site classification: #1193.
Type: **CI tooling and tests. No application behaviour change and no production access.**

## 1. What it is

CI had no step that exercised row level security as an enforced role: `backend-tests` connects as the `postgres` superuser. This adds a job, `restricted-role-lane`, that runs integration tests with the **API connected as a `NOSUPERUSER`, `NOBYPASSRLS`, non-owner role**, while every test keeps its admin connection for seeding and inspection.

It is **required and ratcheting**, so it can gate merges from day one without waiting for every migration:

| Result | Meaning | Lane |
|---|---|---|
| PASS | passed under the restricted role | ok |
| EXPECTED_FAIL | listed in `expectedFailing`, with the migration PR (M1 to M6) that fixes it, and failed | ok (tracked) |
| UNEXPECTED_FAIL | failed and is not listed | **fails** |
| UNEXPECTED_PASS | listed as expected-failing but passed | **fails** until the baseline is ratcheted down |

It also **fails if it cannot show the API really used the restricted role** (the API carries a distinct application name, `vexa-pim-api-restricted`, and the lane must observe such sessions and every one must be the restricted role). A misconfigured lane can therefore never pass.

## 2. How it works without rewriting 186 tests

- `scripts/ci/restricted-db-preload.cjs` is loaded through `NODE_OPTIONS=--require`. The tests are node processes that spawn `apps/api/dist/main.js`; the option is inherited, and in the API child, and only there, the preload repoints the three database variables at the restricted role. Tests keep the admin URL.
- `scripts/ci/create-restricted-runtime-role.cjs` creates the role in the disposable CI database from the repo, with **explicit table-level `SELECT, INSERT, UPDATE, DELETE` grants** (never `ALL`), no sequence grants (the schema has none), no DDL, and asserts what it created: not a superuser, no `BYPASSRLS`, owns nothing, does not own the schema, cannot read `_prisma_migrations`. The platform control row is **read-only** for the runtime and the platform budget counters can be updated but not inserted, so "operators write the kill switch" is a database rule in this model.
- Migrations run first as the admin identity (the migrator stand-in).
- `scripts/run-restricted-role-lane.cjs` runs `scripts/restricted-role-lane.v1.json` (23 tests, six at a time) and writes the table above to the job summary.
- The decision logic is in `scripts/ci/restricted-lane-evaluate.cjs` and is unit tested without a database.
- `scripts/validate-sec-restricted-lane.cjs` guards the lane statically in the `build` job: real test files, tracked baseline entries, role attributes and grants, preload scope, the session proof, and that the CI job has its own database, migrates before creating the role, and has no `continue-on-error`. 20 negative tests prove each rule fires.

## 3. The baseline, measured

Run locally against PostgreSQL 16 built from all migrations: 20 pass and 3 fail as expected. Every failure is product code, not test harness:

| Test | Tracked by | Cause |
|---|---|---|
| `bulk-publish-runs-installation-filter` | M1 | `credential-encryption.service` upserts the connector credential through the context-free client; RLS violation, HTTP 500 on a Shopify install |
| `connector-idempotency-semantics` | M1 | connector credential read and write through the context-free client (Flipkart path) |
| `tenant-provisioning-default-pricing` | M2 | **new test.** Provisioning seeds default pricing through the context-free client and only logs a warning on failure, so every earlier test passed while new tenants were left without pricing. The test asserts the non-empty outcome |

The earlier dry run's other failures (audit, consent, plan usage, connector installation seeding, the raw soft-delete that matched zero rows) were **test-harness seeding**, and disappear because tests now seed as admin. `marketplace-worker-failure-visibility` passes for the same reason.

## 4. How the migration PRs use it

Each of M1 to M6 removes its tests from `expectedFailing` in the same change, which the ratchet forces: when the fix lands, the test passes, becomes UNEXPECTED_PASS, and the PR must delete the entry. The cross-tenant job migrations (M3, M4, M5) must add tests that seed a **non-default tenant** and assert a **non-empty** result, because under RLS those jobs fail silently; each inventory entry in `sec-db-rls-001-call-sites.v1.json` already records the assertion required.

## 5. Limits

- The lane's role models the production target; it is not the production role, and it does not prove production behaviour.
- The 23 tests are a start. Many cross-tenant jobs have no integration test yet; they get one in their migration PR. The lane list is a plain file and is meant to grow.
- Only the API process is switched. Tests that load API code into the test process (for example the advisory-lock test) still run that code as admin.
- A passing lane means "no regression and no unexpected change under a restricted role for these tests", not "tenant isolation certified". Certification is a later step that uses the exact production-equivalent role model.
- The branch-protection rule that makes `restricted-role-lane` a required check is a repository setting that a person must apply.
