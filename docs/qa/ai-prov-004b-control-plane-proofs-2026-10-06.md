# AI-PROV-004b control-plane production proofs: dormant state and kill-switch drill

Date: 2026-10-06
Baseline: `origin/main` at `60da60fc` (AI-PROV-004b-i, #1181)
Type: operator procedure and tooling. **No provider, no credential, no outbound request, no Product mutation.** This closes the control-plane acceptance of 004b-i before any adapter code is written.

The proofs are run by `scripts/ai-control-plane-proof.cjs` against the already-live 004b-i control plane.

## 1. Why this is safe in a single production environment

There is one Railway environment and it is production, so the drill must never leave a permissive window for real customers. Four independent facts guarantee that:

1. **The deployed API's deploy flag stays as it is.** The drill forces `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` on only inside the proof process. While it runs, the live API still denies at G0 whatever the database row says.
2. **Only a synthetic tenant is allow-listed.** The drill's tenant key is `ai-drill-<time>-<random>`. No real tenant can pass the allow-list, even at the database layer.
3. **It refuses to start unless the database is exactly dormant.** Deny-all control row, no platform budget periods, no tenant budget policies, no reservations, no charges, no tenant policies, no execution that ever called a provider. It can therefore never overwrite real configuration.
4. **The window is a few statements and is always closed.** The control row is restored to its exact snapshot in a `finally` block and on SIGINT or SIGTERM, then verified from a fresh read. If the process is killed hard, the stop statement is printed up front:

```sql
UPDATE ai_platform_controls SET kill_switch = true, enabled = false, allowed_tenant_keys = ARRAY[]::TEXT[], updated_by = 'drill-stop', updated_at = NOW() WHERE id = 'global';
```

There is also no caller of the control plane anywhere in the product, so nothing but the proof process can reach it.

## 2. Guard rails in the script

- The target database is never guessed: `AI_PROOF_DATABASE_URL` is required. The script prints the host, port and database name, never the credentials.
- `drill` is a dry run unless `--apply` is given. `--apply` also needs `AI_PROOF_CONFIRM_HOST` equal to the URL host.
- It runs the services compiled in `apps/api/dist` (the same code that was deployed), so build first from the merged commit.
- It writes evidence as JSON when `AI_PROOF_OUT` is set.

## 3. Proof 1: dormant state (read-only)

`node scripts/ai-control-plane-proof.cjs dormant`

| Check | Expected |
|---|---|
| platform control row exists, `enabled = false`, `kill_switch = true` | pass |
| no provider or model pinned, no tenant allow-listed, request cap `0` | pass |
| no platform budget periods, tenant budget policies, reservations, charges or tenant policies; no execution that called a provider | all counts `0` |
| admission with the real (unset) deploy flag | `DENY platform_feature_disabled` |
| admission with the flag forced on in the proof process | `DENY platform_kill_switch` (the database layer denies on its own) |
| the denials report `providerCallAttempted: false` and `canonicalProductMutationEnabled: false` | pass |
| row counts before and after the attempts | identical, so zero reservations, charges or provider activity |

**Not verifiable by the script:** the deployed API's own value of the deploy flag. The variable must be confirmed unset (or not exactly `true`) in the Railway variables by a person, and recorded alongside the result. The database layer denies regardless.

## 4. Proof 2: kill-switch drill (writes, then restores)

`AI_PROOF_CONFIRM_HOST=<host> node scripts/ai-control-plane-proof.cjs drill --apply`

1. Runs the dormant proof and stops if anything fails.
2. While the control row is still deny-all, creates the synthetic tenant policy, tiny budget rows (tenant and platform, day and month, USD 0.10 each) and proves admission is still `DENY`.
3. Enables the control row for the synthetic tenant only (request cap USD 0.01) and proves: admission is `ALLOW` only under that deliberate state, a different tenant is `DENY tenant_not_allowlisted`, the reservation can be claimed and re-validated.
4. Switches the platform kill switch ON and proves: the pre-dispatch re-read now denies (`platform_kill_switch`), new admission denies, and the already-claimed reservation is cancelled **exactly once**. Three further rounds of cancel, reconcile, expire and sweep are all no-ops and change no counter, the budget and request count are released, and no later claim is possible.
5. Re-enables briefly and proves a kill switch flipped **during** a call discards the result and reconciles the usage exactly once (counters show the spend once).
6. Runs the counter audit (must be clean), restores the control row to its exact snapshot, deletes every drill row, and verifies from a fresh read: deny-all, kill switch ON, zero budgets, reservations, charges and tenant policies, and a final admission attempt that is `DENY` and creates nothing.

## 5. Local rehearsal (2026-10-06)

Run against a clean PostgreSQL 16 migrated to main:

- guard rails: no URL is refused; `--apply` without the matching confirm host is refused.
- dormant proof: 11 checks pass.
- full drill: 32 checks pass, including the final state.
- failure inside the permissive window (injected, honoured only on a local host): the control row was restored and every drill row removed, and a following dormant proof passed.
- a first rehearsal run failed on a logging bug in the script itself (a `bigint` in a log line) partway through the drill; the restore still ran and the following dormant proof passed. The bug is fixed.

## 6. Production result

Not yet run. Results are recorded here by a follow-up change once a person has authorised the run and supplied the target. The evidence file and the person's confirmation of the Railway deploy-flag value are attached to that record.

## 7. What this does not change

004b-ii remains held until both production proofs pass and are recorded, and then only with the boundary set by the programme review. A real provider call stays blocked on the AI-POL-003 Security sign-off, the Privacy decisions from #1170, provider and model approval, and a human-provisioned key with a provider-side spend cap.
