# AI-PROV-004b control-plane production proofs: dormant state and kill-switch drill

Date: 2026-10-06 (revised after the first production attempt)
Baseline: `origin/main` at `8185643c`
Type: operator procedure and tooling. **No provider, no credential, no outbound request, no Product mutation, no admin bypass.**

The proofs are run by `scripts/ai-control-plane-proof.cjs` against the already-live 004b-i control plane. Its classification rules are in `scripts/ai-control-plane-proof-lib.cjs` and are unit tested without a database (`scripts/validate-ai-control-plane-proof.test.cjs`, run in CI).

## 1. Why the first version was replaced

The first version assumed a superuser or BYPASSRLS connection. The deployed API connects as a dedicated application role (`vexa_app_v2`), not a superuser. Under forced row level security that role cannot see other tenants' rows without a tenant context, so a count of `0` taken through it proves nothing about the table. The script now connects as whatever role it is given, uses the application's own tenant-context mechanism for tenant-scoped data, never creates or assumes a bypass role, and refuses to treat a hidden zero as proof.

## 2. Result classes

| Class | Meaning |
|---|---|
| `PROVEN` | the connected role can directly establish the fact |
| `UNVERIFIED` | forced RLS, or missing maintenance access, prevents a global assertion |
| `FAILED` | a required deny control is absent, unreadable, malformed or permissive |

Required deny controls (any `FAILED` fails the proof): the platform control row is readable by the app role, `enabled = false`, `kill_switch = true`, the app role holds the grants the control plane needs, effective admission is `DENY`, and provider dispatch is not possible (a denial reports no provider call and no canonical mutation).

Secondary evidence, reported but never required: the tenant allow-list, provider pin and request cap on the control row, and global row counts. A count is `PROVEN` only when the role can see every tenant's rows: it is a superuser or BYPASSRLS, the table has no RLS, or the table has the approved maintenance policy and the count is read through the maintenance transaction. Otherwise it is `UNVERIFIED` with the visible count shown as such.

Verdicts: `DORMANT_PROVEN` and `DORMANT_PROVEN_WITH_UNVERIFIED` (every required control holds; secondary facts may be unverified), `DORMANT_PROVEN_WITH_FINDINGS`, `INCONCLUSIVE` (a required fact could not be established, or nothing required was recorded), `FAILED`.

## 3. Existing maintenance path (reused, nothing new)

004b-i already added an explicit, SELECT-only, transaction-local maintenance marker (`app.ai_maintenance`) on `ai_provider_budget_policies`, `_reservations` and `_charges`. The proof reuses it for those three counts. `ai_tenant_policies` and `ai_executions` have no maintenance path, so their global counts are `UNVERIFIED` unless the role bypasses RLS. No bypass role is created for this proof; if operations later need cross-tenant AI control-plane auditing, a dedicated maintenance capability is designed then.

## 4. Commands

Connection is explicit: `AI_PROOF_DATABASE_URL`, or `AI_PROOF_DATABASE_URL_FROM` naming one of `DATABASE_URL_DIRECT`, `DATABASE_URL`, `DATABASE_URL_POOLED` (for use under `railway run`). The script prints the database name and a short host fingerprint, never a URL, user, password or row payload.

```text
probe     read-only: current role, superuser and BYPASSRLS flags, row_security, per-table privileges, RLS flags,
          maintenance policies, whether the platform control row is readable
dormant   read-only: the probe plus the dormant-state proof
drill     dry run by default (dormant proof and plan); --apply needs AI_PROOF_CONFIRM_HOST equal to the URL host
```

The exact read-only production command (no write path exists in `probe` or `dormant`):

```bash
cd /tmp/rwscratch && AI_PROOF_DATABASE_URL_FROM=DATABASE_URL_DIRECT railway run --service 97bbb4e5-1b6b-4668-95ec-91cfd5c4fa35 node C:/Users/bhoiv/PIM1/.claude/worktrees/friendly-lovelace-20b1ab/scripts/ai-control-plane-proof.cjs dormant
```

## 5. Deploy flag

The deployed API's `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` cannot be read from the script. It is always reported `UNVERIFIED` and is never assumed OFF. A person's attestation can be attached with `AI_PROOF_DEPLOY_FLAG_ATTESTATION`; it is recorded in the evidence, not trusted.

## 6. Kill-switch drill (HELD)

Not to be run until the dormant proof is recorded and the exact writes and cleanup have been reviewed.

1. Runs the dormant proof; refuses to start unless the control row is exactly deny-all (nothing pinned, empty allow-list, cap 0), platform budget periods are provably absent, and the app role holds every privilege the drill and its cleanup need (checked before any write).
2. While the control row is still deny-all, creates a synthetic tenant policy and tiny budget rows, through the application's tenant context, and proves admission is still `DENY`.
3. Enables the control row for the synthetic tenant only (cap USD 0.01) and proves admission is `ALLOW` only there, a different tenant is `tenant_not_allowlisted`, and the reservation can be claimed and re-validated.
4. Switches the kill switch ON and proves the pre-dispatch re-read denies, new admission denies, the claimed reservation is cancelled exactly once, repeated cancel/reconcile/expire/sweep attempts change nothing, and no later claim is possible.
5. Re-enables briefly and proves a kill switch flipped during a call discards the result and reconciles usage exactly once.
6. Restores the control row to its exact snapshot, deletes every drill row (through the drill tenant's own context), and verifies deny-all, kill switch ON, no drill row, and a final `DENY` that creates nothing.

Safety on a single production environment: the deployed API's deploy flag is not touched (the flag is forced on only inside the proof process, so the live API still denies at G0); only a synthetic tenant is allow-listed; the window is a few statements restored in `finally` and on SIGINT/SIGTERM and then verified; and the hard-kill stop statement is printed first:

```sql
UPDATE ai_platform_controls SET kill_switch = true, enabled = false, allowed_tenant_keys = ARRAY[]::TEXT[], updated_by = 'drill-stop', updated_at = NOW() WHERE id = 'global';
```

## 7. Local rehearsal (2026-10-06)

Against a clean PostgreSQL 16 migrated to main, as the superuser and as a `NOSUPERUSER NOBYPASSRLS`, non-owner role:

- superuser dormant: all counts `PROVEN`; restricted role dormant: budget counts `PROVEN` through the maintenance path, `ai_tenant_policies` and `ai_executions` counts `UNVERIFIED` (visible count shown as such), verdict `DORMANT_PROVEN_WITH_UNVERIFIED`.
- hidden count: another tenant's policy row exists; the restricted role reports `UNVERIFIED` with a visible `0` (never `PROVEN 0`), the superuser reports `PROVEN` with `1`.
- negatives: control `enabled = true` fails; kill switch off fails; control row unreadable (SELECT revoked) fails; a missing `INSERT` grant on reservations fails; each exits non-zero with verdict `FAILED`.
- `probe` and `AI_PROOF_DATABASE_URL_FROM` work; a source name outside the allow-list is refused; no URL, user or password is printed.
- drill under the restricted role: dry run writes nothing; `--apply` passes every required check and ends deny-all with no drill row; a failure injected inside the permissive window restores deny-all.

## 8. Production result: dormant proof (read-only), 2026-10-06

Run with the exact command in section 4, as the deployed application role, from this branch's script. The script made no write: `probe` and `dormant` have no write path, and the admission attempts were denied before any row could be created.

```text
VERDICT: DORMANT_PROVEN_WITH_UNVERIFIED   (43 findings: 42 PROVEN, 1 UNVERIFIED, 0 FAILED)
required deny controls: 12 of 12 PROVEN
```

| Finding | Result |
|---|---|
| role | `vexa_app_v2`, `row_security = on`, **superuser = true**, BYPASSRLS = false, and it owns the AI tables |
| app-role grants on the control plane tables | PROVEN, all present |
| platform control row readable by the app role | PROVEN |
| platform `enabled = false` | PROVEN |
| kill switch `= true` | PROVEN |
| no provider or model pinned, allow-list empty, request cap 0 | PROVEN |
| global counts: platform budget periods, tenant budget policies, reservations, charges, tenant policies, executions that called a provider | PROVEN `0` each (global because the role is a superuser, not because RLS was ignored) |
| admission with the process's unset deploy flag | DENY `platform_feature_disabled` |
| admission with the flag forced ON in the proof process | DENY `platform_kill_switch` (the database layer denies on its own) |
| provider dispatch possible | NO, PROVEN (a denial reports no provider call and no canonical mutation) |
| admission attempts created no reservation | PROVEN |
| `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` on the deployed API | **UNVERIFIED** (not readable from the script; a person must confirm it is unset) |

**Finding for separate follow-up, not part of this proof: the deployed application role is a PostgreSQL superuser and owns the tables.** A superuser bypasses row level security even where it is forced, so in production the database layer provides no tenant isolation for this role; isolation rests entirely on the application's tenant-scope layer. That is outside AI-PROV-004b and is recorded here so it is not lost. It also means the global counts above are genuinely global.

The first run of this command printed all findings but crashed while writing the evidence file (a mistyped path), so the verdict line was missing; the script now prints the verdict before writing, and a failed evidence write no longer matters. The command was run a second time to capture the verdict, with the same findings.

## 9. What this does not change

004b-ii stays held until the dormant proof and the drill pass and are recorded, then only with the boundary set by the programme review. A real provider call stays blocked on the AI-POL-003 Security sign-off, the Privacy decisions from #1170, provider and model approval, and a human-provisioned key with a provider-side spend cap.
