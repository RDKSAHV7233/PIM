# SEC-DB-RLS-001 8.2: five append-only ledgers become insert-and-read-only for the runtime

Date: 2026-10-08
Baseline: `origin/main` at `76729795` (8.1b merged)
Issue: #1189. Plan: Sprint 8 (Stage 2, progressive hardening); `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 11.
Type: **tooling and rehearsal. No production access, no role, grant, ownership or credential change, no application change.** The manifest describes the target `vexa_runtime`; production still runs as a superuser until the (HOLD) cutover. Stage 2 does not gate the cutover.

## 1. What changed

| Table | Before (runtime) | After (runtime) |
|---|---|---|
| `audit_logs`, `account_consent_events`, `kpi_metric_events`, `approval_comments`, `connector_mapping_events` | `crud` | **`select-insert`** |

Each carries its reason in `runtime.exceptionsToCrud`. The regular restricted-role CI lane's role script revokes `UPDATE` and `DELETE` on the same five and asserts it, so the lane (API process as the restricted role) is the end-to-end proof. The probe proof's insert count now counts insert-capable levels (it counted `crud` only, which was correct while no table was insert-only).

Why it matters: a ledger is only evidence if the process that writes it cannot rewrite it. With `crud`, a compromised API could edit or delete its own audit trail and consent history. With `select-insert` it can only add rows.

## 2. Evidence that the API never edits or deletes these rows

Searched `apps`, `packages` and `scripts` (not tests):
- **typed accessors** (`update`, `updateMany`, `delete`, `deleteMany`, `upsert`) on all five models: none in `apps/api/src`. The only hits are two `deleteMany` calls in `scripts/seed-realistic-qa-pack-db.cjs`, a test-environment seed that connects as an administrator;
- **raw SQL** (`UPDATE`, `DELETE FROM`, `TRUNCATE`) on the five tables: none outside migrations;
- **nested writes through a parent**: none, and none of the five models has a back-relation, so none is possible;
- **write forms in use**: only `create` and `createMany` (2, 1, 1, 1 and 6 call sites); no raw `INSERT` in application code;
- **the account-deletion worker** (the obvious candidate for an erasure path) touches only MFA enrolments, identities and the deletion request;
- **foreign keys**: queried from the migrated database, not searched. The only one touching these tables is `connector_mapping_events.mapping_version_id -> connector_mapping_versions` `ON DELETE CASCADE`. Only the admin QA seed deletes mapping versions. A cascade runs under the referencing table's owner, so a parent delete needs no `DELETE` privilege on the ledger; the rehearsal proves it (section 3).

A correction recorded honestly: my first foreign-key search used `grep` over migration text and wrongly reported "no foreign keys"; the rehearsal then failed on the real FK and the database query above replaced the search. Static search alone never proves a table is read-only for the runtime; the lane does.

## 3. Verification

- **Rehearsal on real PostgreSQL, 211 of 211 on 16 and on 18** (was 185). For each table the runtime can read it and **append a row under its own tenant**, and cannot `UPDATE`, `DELETE` or `TRUNCATE` it. For `connector_mapping_events` the runtime deletes a real mapping version and the cascade still removes the event (no `DELETE` privilege needed on the child).
- **Probe proof 40 of 40 on 16 and 18.** `db-identity/lib.test.cjs`, the lane guard and the call-site ratchet pass.
- **Mutation check: 12 of 12 caught**, with a passing database-backed control before and after: each of the five tables put back to `crud` and a ledger losing its reason (6, by the library test); the lane role keeping edit rights on one table, only `DELETE` revoked, only `UPDATE` revoked (4, by the role script's own database assertion); the manifest un-narrowed and the proof's count formula reverted (2, by the rehearsal and the probe proof against a real database).
- The restricted-role lane in CI is the end-to-end proof that the API runs with edit and delete revoked on all five.

## 4. A consequence to decide, not hide

These ledgers can now only be removed through a privileged path (the migrator or an operator role), which is the intent: cross-tenant or destructive access needs an explicit, separately governed path. If a future erasure requirement (for example a DPDP request that must also purge consent or audit rows) applies to them, that purge has to be built as a governed operator procedure, not as a runtime `DELETE`. Today's erasure path does not touch them; whether it should is a policy question for Privacy and the owner, outside this change.

## 5. Not verified, and what remains

- Nothing ran against production. The effect applies at the cutover, when `vexa_runtime` exists.
- Lane coverage is the lane's: an application path no lane test exercises is not proven by it (8.4 lists untested call sites). The static search is the other half of the evidence.
- Sprint 8 remaining: **8.3** narrow the default `PUBLIC` database, schema, function and enum privileges (record D-012, D-017); **8.4** expand the lane, and decide row level security or a documented exemption for `AuthIdentity`, `WorkspaceDirectory`, `api_access_keys` and `stripe_webhook_events` (record D-020).
