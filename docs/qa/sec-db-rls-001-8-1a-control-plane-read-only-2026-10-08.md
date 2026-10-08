# SEC-DB-RLS-001 8.1a: connector catalogue and entitlement ledger become read-only for the runtime

Date: 2026-10-08
Baseline: `origin/main` at `e0471d38`
Issue: #1189. Plan: Sprint 8 (Stage 2, progressive hardening) of the master plan; `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 11.
Type: **tooling and rehearsal. No production access, no role, grant, ownership or credential change, no application change.** The manifest describes the target `vexa_runtime`; production still runs as a superuser until the (HOLD) cutover.

## 1. Why this is Stage 2, and why it does not gate the cutover

Stage 1 removed the superuser and the unscoped access. Stage 2 narrows privileges the runtime holds but does not need. It is progressive hardening: Stage 2 items are **not** prerequisites of the Stage 1 cutover unless Security or SRE name a specific item as blocking. Granting less than the runtime needs fails closed; granting more than it needs is the residual risk this reduces (a compromised API could rewrite the connector catalogue or, worse, forge an entitlement).

## 2. What changed

| Table | Before (runtime) | After (runtime) | Written by |
|---|---|---|---|
| `connector_definitions` | `crud` | **`select`** | migrations and operator seeds only |
| `connector_tenant_entitlements` | `crud` | **`select`** | Product Operations, as an append-only ledger (a trigger forbids edits); never the API |

- `packages/db/identity/identity-model.v1.json`: the two levels, each with a reason in `runtime.exceptionsToCrud`.
- `scripts/ci/create-restricted-runtime-role.cjs`: the role of the **regular restricted-role CI lane** now revokes writes on both tables and asserts it. That is what makes the lane the proof: the whole lane (API process as the restricted role) now runs without these writes.
- `scripts/db-identity/lib.test.cjs`: manifest assertions. `scripts/db-identity/rehearse.cjs`: real-database checks.

## 3. Evidence that the API never needs these writes

Searched `apps`, `packages` and `scripts` (not tests):
- typed accessors: `connectorDefinition`, `connectorTenantEntitlement`: no `create`, `update`, `upsert`, `delete` or their `Many` forms in `apps/api/src`;
- raw SQL: no `INSERT INTO`, `UPDATE`, `DELETE FROM`, `TRUNCATE` or `ALTER TABLE` on either table in application code;
- nested writes: no `connectOrCreate` and no nested `create`/`upsert` through a relation;
- the only writers are `scripts/seed-realistic-qa-pack-db.cjs`, `scripts/start-playwright-api.cjs` (test environments, connect as the admin) and `scripts/connector-entitlement-schema-proof.cjs` (a schema proof run as admin);
- the entitlement readers are the publication-target evaluator and fact assembler (`SELECT` only).

Static search alone does not prove a table is read-only (design section 11), so the proof is the lane, below.

## 4. Verification

- **Rehearsal on real PostgreSQL, 171 of 171 on 16 and on 18** (was 163). Eight new checks: the runtime can read both tables, and cannot insert, update or delete in either.
- **Probe proof 40 of 40 on 16 and 18**; its runtime counts are derived from the manifest and moved with it.
- `db-identity/lib.test.cjs`, the lane guard and the call-site ratchet pass.
- **Mutation check: 7 of 7 caught.** Manifest levels put back to `crud` (2) and a narrowed table losing its reason (3, by the library test); the lane role script no longer narrowing either table or both (3, by its own database assertion, with an unmutated control that passes against the same database); the manifest mutated and run through the rehearsal (1).
- The regular restricted-role lane (CI) is the end-to-end proof: all of its API-process integration tests run with these writes revoked.

## 5. Not verified, and the next slice

- Nothing ran against production. The effect applies at the cutover, when `vexa_runtime` exists.
- Coverage is the lane's: a code path no lane test exercises is not proven by it (8.4 lists untested call sites). The static search is the other half of the evidence.
- **8.1b, not in this PR: `tax_regimes`.** It is also a control-plane table, but it has a writer on the deploy path: `deploy-staging.yml` runs `scripts/seed-tax-regimes.cjs` with the same credential the API uses. Narrowing it before that step uses the migrator would break the post-cutover deploy. 8.1b makes the seed use `MIGRATION_DATABASE_URL` when set (as 7.9a did for migrations) and then narrows the table.
- Sprint 8 still to do: 8.2 append-only tables (`audit_logs`, `account_consent_events`, `kpi_metric_events`, `approval_comments`, `connector_mapping_events`), 8.3 `PUBLIC`/schema/function/enum privileges, 8.4 lane expansion and the four non-RLS tenant-keyed tables.
