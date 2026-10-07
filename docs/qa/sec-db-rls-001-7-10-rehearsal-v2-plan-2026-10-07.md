# SEC-DB-RLS-001 7.10: Production-Shaped Rehearsal v2

Status: implementation draft

Date: 2026-10-07

Baseline: `origin/main` at `96b60ff3` (7.9c merged)

Issue: #1189. Stage 1 design: `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 9.

## Purpose

Rehearsal v2 is a local, disposable PostgreSQL 16/18 proof that the target
identities work together in the deployment order. It is not a production
cutover, credential, grant, ownership, RLS-policy, or deployment action.

The existing `scripts/db-identity/rehearse.cjs` already proves the ownership
transfer, target-role verifier, rollback, migrator deployment path,
backup/restore, reporter, and ops scripts. At `96b60ff3` it has 163 checks.
This increment must extend that evidence rather than duplicate it.

## Delta To Implement

1. Add a v2 runner that uses the current manifest to create the disposable
   runtime identity and runs the selected API integration lane with only the
   API/worker subject process connected as that identity. Test setup and
   inspection retain the local admin role, matching the restricted-role lane.
2. Reuse, rather than fork, `scripts/run-restricted-role-lane.cjs` and its
   ratcheting lane configuration. The v2 runner must fail if the subject
   sessions are not proven to use the expected restricted role.
3. Add explicit target-state D-022 proof: after the rehearsal target policy
   set is applied, setting `app.ai_maintenance` as the runtime role grants no
   cross-tenant read. This is a target-state simulation only until 7.2b is
   separately deployed and production-verified.
4. Emit a redacted JSON evidence summary with server major version, manifest
   fingerprint, role attributes, stage results, and failure names. It must not
   include a URL, password, token, or raw customer data.
5. Wire this as a required PostgreSQL 16/18 CI job for source changes that can
   affect the identity model, the rehearsal, the restricted lane, migrations,
   or the identity-wired deploy/backup/operator scripts.

## Required Invariants

- `vexa_runtime` is `NOSUPERUSER`, `NOBYPASSRLS`, non-owner, and cannot run a
  migration.
- Cross-tenant reads and writes fail closed for the runtime identity.
- `SET app.ai_maintenance = 'on'` does not alter that result in the v2 target
  policy set.
- The migrator can migrate and apply grants; backup can dump and restore;
  reporter can only read its declared tables; ops can only perform its declared
  tenant-scoped backfill behavior.
- A rollback rehearsal still restores the pre-transfer ownership snapshot.
- The v2 runner proves the runtime subject process used the restricted role;
  a passing test suite on an admin connection is not evidence.

## Out Of Scope

- Dropping the live `ai_maintenance_read_*` policies or calling that deployed:
  this stays in 7.2b and requires human-authorized deployment and runtime
  verification.
- Creating production roles, credentials, secrets, ownership transfers, or
  changing a production `DATABASE_URL`.
- Stage 2 least-privilege refinement, backup retention policy, and publication
  target work.

## Acceptance

The new v2 command passes on PostgreSQL 16 and 18, writes a redacted evidence
summary, and fails under sensitivity tests that remove the runtime-role proof,
allow a cross-tenant maintenance read, skip the manifest-derived role, or
silently omit a stage. Existing rehearsal, restricted-lane, call-site ratchet,
type-check, and affected integration suites remain green.

## Safety Boundary

The draft must continue to accept only localhost administrative URLs and must
fail closed when PostgreSQL tooling, Docker/container access, required local
credentials, or the expected subject-session proof is unavailable.
