# SEC-DB-RLS-001 7.10R Closure Record

Date: 2026-10-08
Status: **READY FOR HUMAN CLOSURE MERGE**
Issue: #1189
Type: **documentation and evidence only**. This record authorizes no production action.

## Closure Rule

> Execution without valid evidence is **INCOMPLETE**. Evidence without successful execution is **FAIL**. 7.10 passes only because execution and validated, secret-clean evidence passed independently on PostgreSQL 16 and PostgreSQL 18.

This record marks 7.10 `DONE` only when its documentation-only pull request is merged. A defect found during closure review reopens implementation work; it is not fixed in this closure change.

## Delivery History

PR #1240 remains permanently classified as **PARTIAL DELIVERY**. It delivered the rehearsal plan, restricted-role configuration seam, and shared role-name validation. It did not deliver the accepted v2 runner, PostgreSQL 16 or 18 evidence artifacts, or exact-head v2 CI. Completion of 7.10 is established by the combined record of #1240, status correction #1241, corrective implementation #1244, evidence-gate correction #1258, and this closure record; it does not retrospectively change #1240's status.

| Record | Commit | Meaning |
|---|---|---|
| #1240 | `731c4ec4` | permanent partial delivery |
| #1241 | `bb7cb7a0` | documentation correction |
| #1244 | `ee75b726dc865d8b5fbeb54070d707105435a66a` | accepted v2 runner and orchestration |
| #1258 | `2351634bd852ccc7fe0e403bb5cd3a43c1cf6ac9` | validation-gated upload and raw JSON checksum recording |

## Exact-Head Acceptance Evidence

The final corrective PR head `17e53777e50f490663159c1e79343039bdeb2365` passed its PR CI and was merged by #1258 as `2351634b`. The authoritative closure evidence is exact-main CI run [37803148374](https://github.com/Vexaappss/PIM/actions/runs/37803148374) at `2351634bd852ccc7fe0e403bb5cd3a43c1cf6ac9`; every job passed. CI is a mandatory **programme-policy gate**; GitHub branch-protection enforcement is unavailable on the repository plan and is not claimed.

| Lane | Job | Result | Redacted JSON SHA-256 | Artifact ID | ZIP/container SHA-256 |
|---|---:|---|---|---:|---|
| PostgreSQL 16 | `113400644294` | execution, validation, secret scan, checksum, upload: **PASS** | `c0cf49a9332a814b806dd37d0b09ccc8507e8e41dcf0bfc2087b9be73c8c8a9a` | `11561204671` | `1f238006121a74b9572a1ebaf0f2c0669097378655553693c3f1630c61501dbe` |
| PostgreSQL 18 | `113400644344` | execution, validation, secret scan, checksum, upload: **PASS** | `8854604193f16fa1f42b5e49eaf5aa644ba5cae1d2ef182804da956e7ae9a519` | `11560974556` | `d004d0bede23591730a5f0983c77ca8b32d2b56c03fdf98dec3b20567e6998bd` |

Both artifacts were created on 2026-10-08 and expire at `2027-01-06T15:43:53Z`. Build job `113400644226`, backend job `113400644345`, restricted-role job `113400644348`, E2E job `113402742393`, and Node 22/24 connector transport jobs `113400644621` and `113400644505` also passed. The runner recorded all mandatory stages, a clean worktree, exact repository identity, runner/configuration/manifest hashes, and the restricted runtime role proof: `NOSUPERUSER`, `NOBYPASSRLS`, non-owner, unable to migrate or assume privileged identities, and unable to recover cross-tenant access through `app.ai_maintenance`.

The validated contract contains `schemaVersion`, `runId`, start/finish timestamps, repository head/ref with `dirty: false`, PostgreSQL major version, role proof, and `executionResult`, `overallResult`, `validationResult`, and `secretScanResult` all equal to `PASS`. Source fingerprints at the tested head were:

| Input | SHA-256 |
|---|---|
| v2 runner | `7af67ce6e0519e6d6807edbbcd1a35ee3e3538bfa220b02ed4721c8050b40509` |
| identity manifest | `49d349c06cab408d59c3f08e866290156ce388f1610905e8c4a0dd5237e2e6cc` |
| rehearsal configuration | `2104ef505a3cec490c74efddd6cb59ab4f6eb160c25fa304aea0fdb3d3c6db9e` |

Both lanes recorded the ordered stage set: `SETUP`, `CURRENT_STATE_REPRODUCTION`, `ROLE_CREATION`, `GRANT_APPLICATION`, `OWNERSHIP_TRANSFER`, `MIGRATION_AS_MIGRATOR`, `RUNTIME_APPLICATION_TESTS`, `WORKER_AND_SCHEDULER_TESTS`, `RESTRICTED_ROLE_LANE`, `BACKUP`, `RESTORE`, `REPORTER`, `OPS`, `NEGATIVE_SECURITY_TESTS`, `ROLLBACK`, `POST_ROLLBACK_VERIFICATION`, and terminal `EVIDENCE_WRITE`.

`BACKUP`, `RESTORE`, `ROLLBACK`, and `POST_ROLLBACK_VERIFICATION` are evidence classifications over substantive disposable-rehearsal checks, not claims that independent production operations ran.

## Boundary And Remaining Work

- The evidence used disposable PostgreSQL instances and synthetic fixtures; no production database was changed.
- D-022 was simulated only. Live removal of `ai_maintenance_read_*` remains separately gated.
- No production role creation, ownership transfer, credential or Railway-variable change, migration-identity switch, RLS change, deployment, backup restore, or cutover is authorized.
- RLS limits accidental or implicit cross-tenant access; it does not contain a fully compromised API process able to set arbitrary tenant context.
- Production restore proof, remaining Class A/Class C work, M1c, operational rollback, branch-enforcement disposition, named Security/SRE sign-off, and human cutover authorization remain open under 7.11.

## Decision

On merge of this record: **7.10 DONE; proceed to 7.11 design and prerequisite closure only. Sprint 9 production cutover remains HUMAN BLOCKED.**
