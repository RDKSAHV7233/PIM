# SEC-DB-RLS-001 7.9c: opt-in reporter and ops wiring for the operator scripts

Date: 2026-10-07
Baseline: `origin/main` at `44536e46` (7.9b merged)
Issue: #1189. Design: `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 8. Identity model: #1198, #1217.
Type: **tooling and rehearsal. No production access, no role, grant, ownership, RLS or credential change, no application change.** Nothing happens until a person creates the two credentials and stores them where this section says.

## 1. What changed

All three operator workflows use one secret today, `STAGE3_DATABASE_URL` (environment `production`). 7.9c splits them by what they need, opt-in:

| Script (workflow) | Before | After, when the dedicated variable is set | Identity it must prove |
|---|---|---|---|
| `sellable-sku-variantless-audit-report.cjs` (production audit) | `DATABASE_URL` | `REPORTER_DATABASE_URL` | `vexa_reporter`: exact name, not a superuser, BYPASSRLS (a report spans tenants) |
| `media-integrity-readonly-report.cjs` (media confirmation) | `DATABASE_URL` | `REPORTER_DATABASE_URL` | same |
| `sellable-sku-variantless-backfill.cjs` (backfill) | one pass over every tenant on `DATABASE_URL` | `OPS_DATABASE_URL`, **iterating tenants** | `vexa_ops`: exact name, not a superuser, **NOBYPASSRLS** |

- **Unset or blank = unchanged.** A blank value (an unset secret mapped into a workflow) is not the opt-in; the script keeps using `DATABASE_URL` and the original single pass exactly as before.
- `scripts/operator-db-identity.cjs` (new) is the shared rule: which URL, and the identity check that runs before any read or write. A wrong credential fails the run instead of producing an unchecked report or write.
- **The backfill in ops mode** lists the tenants from `WorkspaceDirectory` plus the default tenant (`PIM_DEFAULT_TENANT_KEY`, as the application does), reads each tenant's candidates inside a transaction that first sets `app.tenant_key`, and creates each variant inside its own transaction that sets the context first. Per-row failure isolation, the idempotent re-check, the dry-run default, the two write opt-ins and the row cap (now across the whole run, failing closed) are unchanged. A tenant whose read fails is recorded and the others continue. The report adds `tenantIteration` (directory count, tenants evaluated and failed, per-tenant counts) and says `orphanDetection: "UNVERIFIED_BY_OPS_ROLE"`: a restricted role cannot see rows whose tenant is not in the directory, so it never claims there are none.
- **Manifest delta:** `vexa_ops` gets `SELECT` on `WorkspaceDirectory` (a table with no RLS), because that is where the tenant list comes from. Without it a restricted role would have to guess the tenant list. It cannot write the directory (proved).
- Workflows map `PRODUCTION_REPORTER_DATABASE_URL` and `PRODUCTION_OPS_DATABASE_URL` into the step; the missing-secret guard now fails closed only when **both** the fallback and the dedicated credential are absent. The three workflow validators pin the mapping and the guard. The media validator and the media report test were not registered in `ci.yml`; they are now.

### The failure this prevents
The original single pass, run with a restricted ops credential, **reports success and covers one tenant**: it sees only the default tenant. The rehearsal runs exactly that and records it (1 of the 2 candidates), then shows the tenant-iterating mode finding both.

## 2. Activation (human steps, none of them done here)

1. At the cutover an administrator creates the roles and applies the grants (`create-roles`, `apply-grants`; 7.11). The `vexa_ops` grants now include the directory `SELECT`.
2. A person creates the two credentials and stores them as GitHub secrets in the `production` environment: `PRODUCTION_REPORTER_DATABASE_URL` and `PRODUCTION_OPS_DATABASE_URL`.
3. **The `STAGE3_DATABASE_URL` mapping stays in the workflows as the fallback until the cutover removes it.** While it is there, the step's environment still holds that credential even when the dedicated one is used (the scripts ignore it; the rehearsal runs them with no `DATABASE_URL` at all). Removing the line, and the validator's pin of it, is a deliberate cutover change, not part of this PR. It is listed in the cutover design.
4. Until step 2, nothing changes.

## 3. Evidence

- **`operator-db-identity.test.cjs`** (8 tests): blank is not the opt-in, the dedicated value wins, the source names the variable and never the value; reporter verdict (exact name, not a superuser, BYPASSRLS required); ops verdict (BYPASSRLS forbidden); the client is built with the URL only when opted in; the identity statement is read-only.
- **`sellable-sku-variantless-backfill-tenants.test.cjs`** (12 tests, fake client): the directory plus the default tenant, an empty directory still iterates the default, `PIM_DEFAULT_TENANT_KEY`; context set before each tenant's read; one failing tenant recorded and the rest continue; the cap across the whole run; context set inside the write transaction before the re-check and the create; the original path does not set a context; a product that gained a variant is skipped; a dry run opens no transaction; source-order pins (identity before listing, identity before the first read in both reports, only when opted in).
- **Rehearsal on real PostgreSQL, 163 of 163 on 16 and on 18** (was 138). New stage R8c runs the **real scripts as the real roles**: the original single pass as `vexa_ops` sees 1 of 2 candidates; the ops dry run iterates 3 tenants and finds both, creates nothing; the write run creates both variants, each carrying its own product's tenant; a second run finds nothing; a runtime, reporter or backup credential in `OPS_DATABASE_URL` is refused before any write; the audit report as `vexa_reporter` spans tenants; the media report reads media assets across tenants; a runtime, ops or backup credential in `REPORTER_DATABASE_URL` is refused for both reports; no output contains a password; the seeded data is unchanged afterwards. R8b adds: ops reads the directory and cannot insert, update or delete it.
- **Mutation check: 32 of 32 caught** — see section 4.
- Existing tests unchanged and passing: both report tests, the backfill test, the three workflow validators, the call-site ratchet, the restricted-lane guard, the identity library and tool tests.

## 4. Mutation check

Each mutant was applied to the real file, the matching checker was run, and the original was restored (verified byte-for-byte after each group).

- **Identity helper (8), caught by `operator-db-identity.test.cjs`:** a blank value counted as the opt-in; `DATABASE_URL` winning over the dedicated value; a superuser accepted; BYPASSRLS not required of a reporter; an ops role that bypasses RLS accepted; any role name accepted; a failed identity no longer throwing; the opted-in URL not handed to Prisma.
- **Backfill tenant mode (8), caught by `sellable-sku-variantless-backfill-tenants.test.cjs`:** the default tenant not iterated; a read without the tenant context; a write without it; one failing tenant aborting the run; the cap not enforced across tenants; the identity not checked in ops mode; the write not given the context; the directory not read.
- **Reports (2), same test:** the audit report skipping the identity check; the media report checking even without the opt-in.
- **Workflows and validators (7), caught by the three validators:** the ops variable mapping the wrong secret; the missing-secret guard needing only one credential absent (backfill, audit, media); the ops mapping removed; the reporter variable mapping the ops secret; the reporter mapping removed.
- **Manifest (2), caught by `db-identity/lib.test.cjs`:** ops losing the directory grant; ops allowed to write the directory.
- **Only the real database can catch (5), caught by the rehearsal:** ops mode never activating (the single pass then runs as ops and sees one tenant); the identity check skipped in ops mode; the write not setting the tenant context; the media report never checking its identity; ops unable to list tenants.

## 5. Not verified

- Nothing ran against production. No `vexa_reporter` or `vexa_ops` credential exists; the opt-in paths are exercised only by tests and the rehearsal, not by a GitHub run.
- Which role `STAGE3_DATABASE_URL` holds is still unknown (evidence record section 18).
- Whether the production directory lists every tenant that has products is not provable by a restricted role (hence `UNVERIFIED_BY_OPS_ROLE`); a person with an administrative connection can compare the tenants in `Product` with the directory before the first ops run.
- The reporter is BYPASSRLS by design (reports span tenants). Its credential must never be reachable by the API process; it exists only as a GitHub secret in the `production` environment.
- Sprint 7 remaining after this: 7.10 (rehearsal v2), 7.11 (cutover design).
