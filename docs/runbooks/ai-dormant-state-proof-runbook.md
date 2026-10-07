# AI dormant-state proof runbook (Stream B, B9)

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f`
Type: **documentation only.** This runbook is prepared, **not executed**. Running it needs a human go (section 2). It writes nothing to production: the `probe` and `dormant` commands of `scripts/ai-control-plane-proof.cjs` have no write path.
Status: **proposal / awaiting human approval.** It extends, and does not replace, `docs/qa/ai-prov-004b-control-plane-proofs-2026-10-06.md` (#1183, #1185), which holds the script's design and the 2026-10-06 production result.

## 1. What this proves, and when to run it

**Claim to establish:** the AI provider path is **dormant**: nothing can reach a provider, no budget exists, nothing is enabled, and nothing has run.

**Run it:**

| Trigger | Why |
|---|---|
| after the restricted runtime role is live in production (RLS-5) | the 2026-10-06 result was taken as a superuser; it was an application-layer proof (ledger, finding F-3) |
| after 7.2b (the `ai_maintenance_read_*` policies dropped) | the script's global counts depend on those policies; they degrade to `UNVERIFIED`, which must be understood before the result is read (section 5) |
| immediately before the kill-switch drill (B10) | the drill refuses to start unless the control row is exactly deny-all |
| immediately before the first controlled provider call | a fresh proof, not an old one |
| after any deploy that touches `apps/api/src/intelligence` or the provider variables, and periodically during the pilot | dormancy is a state, not an event |

## 2. Authorisation and safety

1. **A named human gives an explicit go for each run**, in the record (section 8). A previous attempt to read production with the API's own credentials was blocked by the environment's production-read control; that is correct behaviour. The run is performed by a human, or by an agent only with the human's explicit go for that run.
2. The run is **read-only**: `probe` and `dormant` only. **Never `drill --apply`** from this runbook; that is B10 and needs its own authorisation.
3. The script prints the database name and a short host fingerprint, never a URL, user, password or row payload. Evidence records contain **names, counts and booleans only**: no secrets, no DSNs, no customer data, no row contents.
4. Nothing is enabled, created or changed. If any step appears to require a write, stop.

## 3. Evidence required (the eight facts) and how each is established

Result classes (script): `PROVEN` (the connected role can directly establish it), `UNVERIFIED` (forced RLS or missing access prevents a global assertion), `FAILED` (a required deny control is absent, unreadable, malformed or permissive). **A count of zero seen through a role that cannot see every tenant is `UNVERIFIED`, never `PROVEN`. RLS-hidden rows are never global proof.**

| # | Fact | How established | Required? | Expected class after the role cutover |
|---|---|---|---|---|
| 1 | Provider feature flag OFF (`FEATURE_INTELLIGENCE_PROVIDER_ENABLED` unset or false) | **not readable by the script**; always reported `UNVERIFIED`. Evidence is a human observation of the API service's variable list (the name absent, or the value false), dated and timed, attached with `AI_PROOF_DEPLOY_FLAG_ATTESTATION` and recorded; it is evidence, not trust | yes (by attestation) | `UNVERIFIED` in the script, **plus** a recorded human attestation by one person and confirmed by a second |
| 2 | Platform enabled = false | platform control row read (`enabled`) | yes | `PROVEN` |
| 3 | Kill switch = ON | platform control row (`kill_switch`) | yes | `PROVEN` |
| 4 | No tenant enabled | control row: no provider or model pinned, `allowed_tenant_keys` empty, request cap 0; plus no tenant policy with provider execution enabled | yes (control row); the tenant-policy count is secondary | control row `PROVEN`; tenant-policy count see section 5 |
| 5 | Zero budget | no platform budget period rows (the platform tables carry no tenant key and no row level security, so this is global even for the runtime role); no tenant budget policy row with a non-zero limit (tenant table, forced RLS) | secondary | platform period rows `PROVEN`; tenant policies see section 5 |
| 6 | Provider dispatch impossible | admission evaluated twice: with the process's deploy flag (denies `platform_feature_disabled`) and with the flag forced ON inside the proof process only (denies `platform_kill_switch`: the database layer denies on its own); a denial reports no provider call and no canonical mutation | yes | `PROVEN` |
| 7 | No unexpected reservation | admission attempts created no reservation; reservation count | secondary (the attempts check is required) | attempts `PROVEN`; count see section 5 |
| 8 | No unexpected execution | execution count and the count of executions that called a provider | secondary | see section 5 |

The app role must also hold every grant the control plane needs (checked as a required finding), and must be able to read the control row.

## 4. Procedure

1. Record the go (section 8): who, when, which environment, the role the proof will connect as.
2. **Confirm which role the script will connect as** and record it by name. After the cutover this is the new runtime credential; before it, `vexa_app_v2`. Do not substitute a privileged credential to make counts look global.
3. Run `probe` (read-only): current role, superuser and BYPASSRLS flags, `row_security`, per-table privileges, RLS flags, whether the maintenance policies exist, whether the control row is readable. **Stop if the role is a superuser or BYPASSRLS after the cutover**: the cutover has not achieved its purpose and the proof is not a database-isolation proof.
4. Run `dormant` (read-only), using the command pattern in `docs/qa/ai-prov-004b-control-plane-proofs-2026-10-06.md` section 4 (`AI_PROOF_DATABASE_URL_FROM` naming the variable under `railway run`; service id as recorded there). Attach the flag attestation (fact 1).
5. Capture the **verdict line first** (the script prints it before writing evidence) and the findings.
6. A second person independently reads the Railway variable list and confirms fact 1.
7. Fill in the evidence record (section 8). Store it with the other compliance records; commit **only** names, counts and booleans, in a docs PR, never raw output that could carry a host or identifier.

## 5. Reading the result as the restricted runtime role

Before the cutover the proof ran as a superuser, so its global counts were `PROVEN`. As a non-superuser, non-BYPASSRLS, non-owner role:

| Item | What the role sees | Class | Consequence |
|---|---|---|---|
| platform control row, platform budget period rows, grants, admission denials | the platform tables have no tenant key and no RLS policy in the 004b-i migration; admission is evaluated in-process | `PROVEN` | the required deny controls stay provable by the runtime role |
| counts on tables with forced RLS (tenant policies, executions, budget policies, reservations, charges) | only the default tenant, unless a tenant context is set | `UNVERIFIED` | **never** reported as "zero globally" |
| counts through the maintenance policies | global **while the `ai_maintenance_read_*` policies exist** (the script detects them in `pg_policies`) | `PROVEN` before 7.2b; after 7.2b the policies are gone and the same counts become `UNVERIFIED` | an expected degradation, not a regression; do not "fix" it by adding a privileged read |
| the same counts read **per tenant** (tenant context set for each tenant in the directory) | each known tenant's rows | `PROVEN` for the tenants evaluated; the set of tenants is reported | the honest statement is "N of N directory tenants evaluated"; rows of tenants **not in the directory** remain `UNVERIFIED_BY_RUNTIME_ROLE` |
| global counts through an **approved read-only audit identity** (`vexa_reporter` is proposed in Stream A's #1217; not yet approved or provisioned) | everything, read-only | `PROVEN` | only if Security approves that identity and it exists; this runbook does not create or request one |

**Proposed script change (a Stream B implementation task, after the Stream A readiness signal; not part of this PR):** count per tenant by iteration over the directory (union the default tenant) with tenant context set for each, report `tenantsEvaluated` and the unevaluated remainder, and keep the maintenance-policy path only while the policies exist. The script is standalone and does not use Stream A's helpers.

## 6. Acceptance criteria for "dormant" (gate for B10 and the first provider call)

All must hold; any exception is recorded and decided by Security, not by the runner:

- [ ] verdict is `DORMANT_PROVEN` or `DORMANT_PROVEN_WITH_UNVERIFIED`; **never** `FAILED`, `INCONCLUSIVE` or `DORMANT_PROVEN_WITH_FINDINGS`;
- [ ] all 12 required deny controls `PROVEN` (control row readable, `enabled = false`, kill switch `true`, grants present, admission `DENY`, dispatch impossible, and the associated admission checks);
- [ ] fact 1 attested absent or false by two people, within 24 hours of the run;
- [ ] every `UNVERIFIED` finding is listed, named and explained; for each fact in rows 4, 5, 7 and 8, either per-tenant counts for **every directory tenant** are `PROVEN` zero, or the item is recorded as `UNVERIFIED_BY_RUNTIME_ROLE` and accepted by Security;
- [ ] the connected role was recorded and is **not** a superuser, BYPASSRLS or owner (post-cutover runs only);
- [ ] no `drill --apply`, no write, and no other change was made during the run.

## 7. If the result is `FAILED` or `INCONCLUSIVE`

Stop. Enable nothing. Do not run the drill or send a provider request. Notify Security. If the control row is not deny-all, the hard-stop statement is in the 2026-10-06 proofs document (section 6) and is run **only** by an authorised human with database access: it sets the control row to deny-all and the kill switch on. Investigate the cause (migration, manual change, deploy), restore the exact deny-all state, then run the whole proof again from step 1.

## 8. Evidence record (template; names, counts and booleans only)

| Field | Value |
|---|---|
| Date and time (UTC) | |
| Authorised by (name) / run by (name) | |
| Environment, connected role (name), superuser / BYPASSRLS / owner (booleans) | |
| Script commit (SHA) and command (`probe`, `dormant`) | |
| Verdict line | |
| Findings: PROVEN / UNVERIFIED / FAILED counts | |
| Required deny controls PROVEN (n of 12) | |
| Flag attestation: observer 1, observer 2, time observed | |
| UNVERIFIED items with reasons | |
| Directory tenants evaluated (n of N), unevaluated remainder | |
| Acceptance criteria met (section 6): yes / no, exceptions and who accepted them | |
| Verifier (second person) name and date | |

## 9. What this runbook does not do

It executes nothing, changes nothing in production, enables nothing and creates no role or credential. It does not authorise the kill-switch drill, 004b-ii or a provider call. The script change in section 5 is described, not made.
