# AI kill-switch drill runbook (Stream B, B10)

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f`
Type: **documentation only, held.** This runbook is prepared. **It is not executed, and nothing in it authorises execution.** The drill writes to the production control plane, so it needs an explicit human authorisation (section 3) that no agent can give.
Status: **proposal / awaiting human approval.** It builds on `docs/qa/ai-prov-004b-control-plane-proofs-2026-10-06.md` (#1183, #1185), whose `scripts/ai-control-plane-proof.cjs drill` command implements the drill.

## 1. Purpose

Prove, in the real environment, that the kill switch **works as designed**: after it is turned on, a claimed reservation cannot be dispatched, is settled **exactly once**, and the system returns to **deny-all**, all **without any provider request** (no adapter, no credential and no network path exist; 004b-ii is not implemented).

## 2. The nine steps, mapped to what the script does

| # | Plan step | What the drill does (script `drill`, `--apply`) | Pass condition |
|---|---|---|---|
| 1 | Establish controlled internal eligibility | With the control row still deny-all, creates a **synthetic** tenant policy and tiny budget rows; then enables the control row for **only** that synthetic tenant (request cap 0.01 USD, a test provider and model pin) | with full tenant and budget configuration but a deny-all row, admission is `DENY` (`platform_kill_switch`); after enabling, admission is `ALLOW` only for the synthetic tenant and `tenant_not_allowlisted` for any other |
| 2 | Create a reservation | admits one request for the synthetic tenant | reservation created, four counters charged |
| 3 | Claim the reservation | claims it | `claimed = true`, a claim token issued |
| 4 | Enable the kill switch | sets `kill_switch = true` on the platform control row | the row reads `true` |
| 5 | Run the pre-dispatch re-check | calls `revalidateBeforeDispatch` | denies with `platform_kill_switch`; new admission also denies |
| 6 | Prove dispatch does not occur | the pre-dispatch path never reaches the work callback; a second scenario flips the switch **during** a stand-in call (a callback, not a provider) and shows the result is **discarded** | `result_discarded` with `kill_switch_during_call`; no value returned |
| 7 | Settle or cancel exactly once | cancels the claimed reservation, then repeats cancel, reconcile, expire and sweep three times; reconciles the during-call scenario once | the first settlement is `applied`; every repeat is a no-op; counters unchanged by repeats; budget and request count released after the cancel; reconciled spend appears once |
| 8 | Return production to deny-all | restores the control row to its **exact snapshot**, then deletes every drill row | `enabled = false`, kill switch `true`, nothing pinned, allow-list empty, cap 0; no drill row remains (read through the drill tenant's own context, and by id for platform rows) |
| 9 | Independently verify the final state | the script's own final admission attempt (`DENY`, creates nothing) **plus** a separate read-only dormant-state proof run by a second person (B9) | verdict `DORMANT_PROVEN` or `DORMANT_PROVEN_WITH_UNVERIFIED`; counters and rows as before the drill |

## 3. Authorisation, and the review that must precede it

The programme rule: the exact writes and cleanup are **reviewed first**; the drill runs **only** if the dormant proof passed; it runs **only** on a named human's explicit go for that run.

**Preconditions (all recorded, with who and when):**

- [ ] the dormant-state proof (B9) passed its acceptance criteria within 24 hours;
- [ ] **the drill script is fixed (section 5, P1 and P3)**: without P1 the drill cannot pass, and without P3 it cannot run under the target identity model;
- [ ] the writes in section 4 reviewed and accepted by Security and SRE, in the record;
- [ ] a named **operator** holds the database access needed for the hard-stop statement (section 6) and has **rehearsed** it (step 8 of the procedure);
- [ ] a change window with no concurrent deploy, migration or other control-row change; the on-call engineer and Security notified;
- [ ] Stream A's readiness signal is recorded (the runtime role the drill uses is the post-cutover role, or the drill is explicitly run under the existing role with the superuser limitation recorded);
- [ ] a rollback owner named.

If any box is empty, **do not run**.

## 4. Exact writes (for the review)

All against the production database, in one short window, restored in a `finally` block and on `SIGINT` and `SIGTERM`, then verified. Nothing else is touched: no tenant data, no product, no `WorkspaceDirectory` row, no Railway variable, no deploy flag (the flag is forced on **only inside the proof process**, so the live API still denies at the first gate).

| Table | Operation | Rows | Cleanup |
|---|---|---|---|
| `ai_tenant_policies` | INSERT one policy for the synthetic tenant (key `ai-drill-<time>-<random>`, `approvedBy = kill-switch-drill`) | 1 | DELETE by tenant key |
| `ai_provider_budget_policies` | INSERT day and month rows for the synthetic tenant (limit 0.10 USD, small request limit) | 2 | DELETE by tenant key |
| `ai_platform_budget_periods` | INSERT the day and month platform rows (limit 0.10 USD, request limit 10) | 2 | DELETE by id |
| `ai_platform_controls` | UPDATE the single `global` row several times: enable for the synthetic tenant, kill switch on, off, on; **final restore to the exact snapshot** | 1 row | restored to the snapshot taken before any write |
| `ai_provider_budget_reservations` and `ai_provider_budget_charges` | INSERT through admission (the first reservation, the during-call reservation); counters updated by reserve and settle | a few | DELETE by tenant key |

The script refuses to start unless the control row is **exactly deny-all** (nothing pinned, empty allow-list, cap 0), platform budget periods are provably absent, and the connected role holds every privilege the drill and its cleanup need (checked before any write).

**What the drill cannot do:** send a provider request (no adapter exists), spend money (the stand-in callback reports an invented usage figure of 3,000 micros, 0.003 USD, to the **drill's own** budget rows, which are then deleted), enable any real tenant (the allow-list holds only the synthetic key), or leave the flag on.

## 5. Preconditions found by reading the script (must be fixed before authorisation)

These are findings from reading `scripts/ai-control-plane-proof.cjs` against `main` at `a475cc0f`. They have **not** been run; each should be confirmed by a local rehearsal.

| # | Finding | Why it matters | Proposed fix (a Stream B change to the script only; no Stream A file) |
|---|---|---|---|
| **P1** | The final step `the counter audit is clean` calls `auditCounters()`. Since #1214 that audit iterates the tenants in the **directory** (union the default tenant) and compares platform counters against the sum over those tenants. The synthetic drill tenant is **not** in the directory, so the platform period rows (which hold the drill's 3,000 micros and one request) would not be explained and the audit would report drift. | the drill would fail its last step. The restore still runs (it is in `finally`), so this is safe, but the drill could not pass as written | take the audit **before** the drill and **after** the cleanup and assert the two are **equal** (the drill rows are gone by then); keep the drill-local counter checks that already exist for the drill rows. Do not register the synthetic tenant in the directory (an extra production write) |
| P2 | The drill creates its synthetic tenant through `prismaService.tenant(tenant)`, so under a restricted role the writes carry tenant context and satisfy the tenant policies; under a superuser they bypass them. The proof's result differs in meaning between the two | a pass as a superuser proves the control-plane logic, not tenant isolation | record the connected role and its flags in the evidence (section 8); a post-cutover run is the meaningful one |
| P3 | **The drill's single-connection design does not fit the target identity model.** In `packages/db/identity/identity-model.v1.json` the runtime role `vexa_runtime` gets `SELECT` only on `ai_platform_controls` and `SELECT, UPDATE` only on `ai_platform_budget_periods` ("operators write the kill switch through `vexa_ops`, never the API"), while the operator role `vexa_ops` gets full access to **those two tables only** and nothing on the tenant tables. The drill needs `UPDATE` on the control row and `INSERT`/`DELETE` on platform periods **and** `INSERT`/`DELETE` on the tenant policy and budget tables, over one connection. After the cutover no single identity holds both sets, so the script's own privilege pre-check will refuse to start (safe, but the drill cannot run) | the drill cannot be run post-cutover as written, and widening either role to make it pass would break the model Stream A built | split the drill across **two connections**: platform-table writes through the operator identity, tenant-table writes through the runtime identity (each named by its own `*_FROM` variable, each supplied by a human). Until then the only runnable version is the superuser one, whose result is an application-layer proof (P2). Do not widen a grant to make the drill pass without Security |

## 6. Abort, hard stop and who can run it

**Abort conditions:** any step failing (the script restores and exits non-zero); the process receiving `SIGINT` or `SIGTERM` (it restores before exit); loss of the database connection mid-window; any unexpected deploy or alert during the window. On any of these the **first action** is to verify deny-all.

**Hard-stop statement** (from the 2026-10-06 proofs document, section 6), to be run **only by the named operator**:

```sql
UPDATE ai_platform_controls SET kill_switch = true, enabled = false, allowed_tenant_keys = ARRAY[]::TEXT[], updated_by = 'drill-stop', updated_at = NOW() WHERE id = 'global';
```

**Gap (also recorded in the credential runbook, B6):** there is no operator command for the kill switch today (it is planned as 004b-ii-c), and which database identity may run this statement after the role cutover is **not decided**. Stream A's identity model names the operator path: `vexa_ops`, full access to the two platform control tables and nothing else (`identity-model.v1.json`); it is **not provisioned in production**, and who holds its credential is **not decided**. Until it exists and is approved, the holder of this access is whoever the CTO names, recorded here: ____________________. The operator **rehearses** the statement at the end of the drill (step 8 of the procedure): run against the restored deny-all state it changes nothing but `updated_by` and `updated_at`, and it proves the access works before an emergency.

## 7. Procedure

1. Record the authorisation (section 3) and the connected role (name, superuser, BYPASSRLS, owner).
2. Run `probe` and `dormant` (read-only, B9) and confirm acceptance. Record the control-row snapshot values (names and booleans).
3. Run `drill` **without** `--apply` (the default dry run): it prints the plan and the preconditions checked; confirm they match section 4.
4. Announce the window start to on-call and Security.
5. Run `drill --apply`. `AI_PROOF_CONFIRM_HOST` must equal the database host (a typed confirmation that the target is the intended one); the script prints the hard-stop statement first. Do not interrupt it unless an abort condition occurs.
6. Capture the verdict line and every `PASS`/`FAIL` step output.
7. Without delay, run `dormant` again (read-only) as the **second person**, independently, and compare: control row `enabled = false`, kill switch `true`, nothing pinned, allow-list empty, cap 0; no drill rows; platform budget periods absent; counters as before.
8. The operator **rehearses the hard-stop statement** against the restored state and records that it executed and that the row is unchanged in meaning.
9. Announce the window end. Fill in the evidence record (section 8).

## 8. Evidence record (names, counts and booleans only)

| Field | Value |
|---|---|
| Authorised by / run by / observer (names), window start and end (UTC) | |
| Environment; connected role (name); superuser / BYPASSRLS / owner (booleans) | |
| Script commit (SHA); `drill` dry run reviewed (yes/no) | |
| Control-row snapshot before and after (booleans and counts; "exact match" yes/no) | |
| Steps passed (n of n) and any failing step | |
| `result_discarded` observed with `kill_switch_during_call` (yes/no); first settlement applied once, repeats no-ops (yes/no) | |
| Drill rows remaining (counts per table, expected 0) | |
| Independent `dormant` verdict and acceptance (second person, name, time) | |
| Hard-stop statement rehearsed by (name), result | |
| Provider requests made (expected 0) | |

## 9. What this runbook does not do

It authorises and executes nothing. It does not enable any tenant, set any budget, create any credential, change any flag or send any request. The drill, 004b-ii and the first provider call remain held. The fixes in section 5 are described, not made.
