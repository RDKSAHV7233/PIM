# Programme reconciliation: current programme-state index

Date: 2026-10-08 (evidence gathered 2026-10-07 to 2026-10-08)
Closure baseline: `origin/main` at **`2351634b`** (#1258). Exact-main CI run `37803148374` is green on all jobs, including independent PostgreSQL 16/18 rehearsal evidence and `e2e`.
Type: **documentation and state only.** No code, flag, validator, migration or workflow changed. No approval, sign-off or acceptance is created or inferred.

**This reconciliation is the current programme-state index as of 2026-10-08. Earlier plans and ledgers remain historical evidence but do not override current `origin/main`, verified runtime evidence, or this reconciliation.**

**A backlog item in a superseded plan is not evidence that implementation remains outstanding. Current `main` must be inspected before any new work begins.**

It supersedes `docs/qa/vexa-ai-programme-ledger-2026-10-07-r2.md` (and the older B0 ledger) as the single current status source. The detailed investigation behind it is the 2026-10-07 current-state report; section 9 lists what to re-check before relying on any row.

## 1. How to read every row: four separate kinds of state

A merge is not a deployment, a deployment is not runtime evidence, and none of them is an approval. Each item below is stated on four axes:

| Axis | Values used |
|---|---|
| **Implementation** | `DONE`, `PARTIAL`, `OPEN`, `DESIGN_ONLY` (what is on `main`) |
| **Deployment** | `DEPLOYED` (merged to `main`, which auto-deploys), `NOT_DEPLOYED`, `NO_PRODUCTION_EFFECT` (tooling, docs or an opt-in path nobody has switched on) |
| **Runtime evidence** | what was actually observed on the deployed system or in CI, with date; `NONE` where there is none |
| **Approval / lock** | `NOT RECORDED`, `PENDING`, `REWORK` (historical), and `locked: false` unless an acceptance is on record |

Other vocabulary: `DECISION_READY` is a merged packet, plan or runbook that prepares a decision; **it is never "approved"**. `HUMAN_GATED` needs a human decision or a production action no agent may supply. `BLOCKED` waits on a named predecessor. `HOLD` and `NO-GO` are the owner's decisions of 2026-10-08, recorded in section 7.

## 2. Canonical repository record

| Item | Record |
|---|---|
| Canonical repository | **`Mixwage/PIM`** (private, Organization-owned, default branch `main`) |
| Redirects | `Vexaapps/PIM`, `RDKSAHV7233/PIM`, `Dotesvbpim/PIM` all resolve to it |
| Always use | `--repo Mixwage/PIM` with `gh` |
| Local `origin` | `https://github.com/Mixwage/PIM.git` |
| Stale local remotes (nine) | `alt`, `canonical`, `dotesvb-alt`, `doteswithvb-alt`, `vbpim`, `vbpim12`, `vexaap`, `vexasaas`, `vexasaass`; `git fetch --all` is slow because of them |
| PR author account | `RDKSAHV7233` is the `gh` login used by this environment; **the author name does not identify which stream or session produced a PR** |
| Railway source repository | UNVERIFIED (variable and source reads are not available to the investigating session) |
| Branch protection / rulesets | `protected=false`; protection API 404; rulesets 403 "Upgrade to GitHub Pro or make this repository public" (2026-10-07) |

## 3. SEC-DB-RLS-001 (#1189, open)

| Item | Implementation | Deployment | Runtime evidence | Approval / lock |
|---|---|---|---|---|
| Investigation, probe, call-site inventory and ratchet, restricted-role lane (#1188 `821c6948`, #1190 `1712c465`, #1199 `09d8ed52`, #1193 `731afa94`, #1195 `5a2c325c`, #1203 `ef144449`, #1205 `4dc700a3`) | DONE | NO_PRODUCTION_EFFECT (docs, tooling, CI) | read-only production probe 2026-10-06: only `postgres` and `vexa_app_v2` exist, **both superusers** | NOT RECORDED; locked false |
| Identity model and rehearsal (#1198 `37299a6b`, #1217 `9a9241d0`) | DONE | NO_PRODUCTION_EFFECT | CI at `96b60ff3`: **163/163 checks on PG16 and 163/163 on PG18** | NOT RECORDED; locked false |
| Rehearsal v2 plan and lane config (#1240 `731c4ec4`) | PARTIAL (plan plus lane config; full API/worker runtime-role orchestration UNVERIFIED) | NO_PRODUCTION_EFFECT | CI at `731c4ec4`: rehearsal 163/163 on both versions, restricted-role lane 30 pass / 0 unexpected | NOT RECORDED; locked false |
| Rehearsal v2 corrective implementation and evidence (#1241, #1244 `ee75b726`, #1258 `2351634b`) | DONE on merge of the 7.10R-3 closure record; #1240 remains permanently PARTIAL | NO_PRODUCTION_EFFECT | exact-main run `37803148374`: PG16 and PG18 execution, validation, secret scan, JSON checksum and upload PASS; all other jobs PASS | closure acceptance PENDING; production cutover remains HOLD |
| Connector credential writes and connectors on the tenant client (M1a #1200 `47f31c98`, M1b #1202 `a71fc6d1`) | DONE (15 connectors use `tenantDb()` **with an optional direct-client fallback**) | DEPLOYED | restricted-role lane green | NOT RECORDED; locked false |
| Tenant iteration helpers (#1204 `772fd2c5`; #1209 `5d141a8e`) | DONE; two helpers exist, the service has **zero consumers**, the transaction helper has six | DEPLOYED | unit and lane tests | NOT RECORDED; **no third abstraction authorised** |
| Credential rotation (#1204), provisioning seed (#1206 `b2d61b87`), billing jobs (#1210 `73a4af06`), explicit-tenant raw SQL (#1208 `03f26bd2`), lane isolation (#1213 `7e74a8e9`) | DONE | DEPLOYED | positive-result tests and mutation checks in CI; restricted-role lane | NOT RECORDED; locked false |
| Signed public media route (D1 #1211 `2aa5d430`, D1b #1212 `fee87db5`) | DONE | DEPLOYED; **`MEDIA_URL_SIGNING_KEY` unset** | live 2026-10-07: unsigned request for a nonexistent asset returns 404, garbage token ignored (a set key would return 401) | key activation HUMAN_GATED |
| AI sweeper and counter audit on tenant iteration, 7.2a (#1214 `a475cc0f`) | DONE | DEPLOYED | unit tests; **runtime positive-result verification NOT DONE** | NOT RECORDED |
| 7.2b: drop the three `ai_maintenance_read_*` policies | OPEN | NOT_DEPLOYED | the policies still exist in the database; no application source sets the marker | BLOCKED on 7.2a runtime verification |
| Migrator, backup + real restore test, reporter + ops wiring, 7.9a/b/c (#1232 `b98da256`, #1234 `44536e46`, #1237 `96b60ff3`) | DONE (opt-in) | NO_PRODUCTION_EFFECT | no `MIGRATION_`, `BACKUP_`, `REPORTER_` or `OPS_DATABASE_URL` secret exists in GitHub (names checked 2026-10-07); Railway variables UNVERIFIED; restore against a real backup UNVERIFIED | credential provisioning HUMAN_GATED |
| Remaining class-A jobs (ten): `plan-usage`, `bulk-edit-stale-operation-recovery`, `bulk-import-stale-row-recovery`, `connector-webhook-lease-sweeper`, `export-job-reconciliation`, `woocommerce-reconciliation`, `media-integrity`, `outbound-webhooks` recovery, `internal-ops-alerts`, `internal-ops-summary` | OPEN | n/a | would see only the default tenant under a restricted role | n/a |
| Class C: `auth.service` review, `commercial-requests` (D2), `stripe.service` (D3), `tenant-directory` split, `media.service` unsigned branch | OPEN | n/a | n/a | decisions D2-D4 locked; implementation open |
| M1c: remove the optional direct-client fallback (15 connectors, 3 services) | OPEN | n/a | n/a | n/a |
| Production runtime cutover | OPEN | NOT_DEPLOYED | production still runs as a superuser as far as evidence shows (last evidence 2026-10-06) | **HOLD (CUTOVER_BLOCKED)** |

## 4. Gate A and the AI programme

| Item | Implementation | Deployment | Runtime evidence | Approval / lock |
|---|---|---|---|---|
| **Gate A** (issues #1075 to #1109) | n/a | n/a | n/a | **Historically REWORK** (Security, CTO, QA, PO), recorded 2026-10-04 04:36 UTC; by 05:05 UTC blocked only by RG-003. **No later decision found; no issue closed.** Retrospective disposition: `docs/execution/GATE_A_RETROSPECTIVE_DISPOSITION_2026-10-08.md` (owner field blank) |
| Governed AI foundation: AI-SEC-001 #1133; AI-EVAL-001/002a/002b #1132 #1161 #1163, packet #1171; AI-POL-001/002/003 #1135 #1145 #1167 #1173; AI-CORE-002/003/004 #1139-#1143 #1147; AI-SRE-001 #1136; AI-GOV-001 #1137; AI-PROV-001/002/003/003b #1150 #1153 #1155 #1158; AI-PROV-004a #1175; AI-PROV-004b design and 004b-i #1176 #1178 #1181; control-plane proof #1183 #1185 #1186; validator CI gate #1164 | DONE (first PRs merged 2026-10-04 12:50 UTC, about eight hours after the REWORK decisions; AI migrations `20261004163000` to `20261005120000` followed) | DEPLOYED | production dormant proof 2026-10-06: `DORMANT_PROVEN_WITH_UNVERIFIED`, **taken as a superuser**; FAST evaluation all 1.0 (machinery only); **no FULL evaluation has ever run** | **Gate A REWORK predates this work; PO/CTO acceptance NOT RECORDED**; AI-POL-003 Security confirmation not on file; locked false |
| Governed layer facts | n/a | n/a | no `fetch`, SDK, provider hostname or network code; no adapter-zone directory; no provider SDK dependency; no provider-key variable; validators still forbid network code everywhere | n/a |
| `/ai` exposure fix (QA-AI-01, #1238 `9b24167e`, issue #1236 closed) | DONE (explicit fail-closed flag `FEATURE_INTERNAL_AI_LAB_ENABLED` on the page, the repair action and `apply=true` repair) | DEPLOYED | live 2026-10-07: `/ai` shows "Page not found" for an Admin; the API apply gate and the server action were **not** exercised live | NOT RECORDED; **GAF-014 (#1098, #1090) remains OPEN** |
| AI Surface Census (#1239 `707fd0d2`, `docs/qa/ai-surface-census.v1.json`) | DONE (16 surfaces) | NO_PRODUCTION_EFFECT | live probes recorded per row | DECISION_READY |
| Stream B packs and runbooks (#1216 #1218 #1219 to #1231, #1233 #1239): Security, Privacy, provider/model, FinOps, credential runbook, 004b-ii design, network-guard plan, dormant-proof, drill, FULL evaluation, Gate B, media activation runbook | **Artifacts DONE** | NO_PRODUCTION_EFFECT | n/a | **Decision packets DECISION_READY; human sign-offs PENDING; provider authorization NOT GRANTED**; every sign-off box blank; locked false |
| Provider and model | recommendation only (Anthropic, `claude-sonnet-5-5`, US-pinned) | none | none | **NOT APPROVED**, not configured, no key, not live |
| Golden Catalog (64 cases) | DONE as fixtures | DEPLOYED (test fixtures) | 64 DRAFT, 0 with approval metadata, 0 authoritative | PIM SME, QA, Security approvals PENDING |
| 004b-ii adapter zone | DESIGN_ONLY | n/a | n/a | **HOLD** |

## 5. Other streams

| Item | Implementation | Deployment | Runtime evidence | Approval / lock |
|---|---|---|---|---|
| QA Acceptance Lane (#1235 `0a454ed7`) | plan DONE; execution PARTIAL | n/a | on tenant `admin`: PROD-01, PROD-08, BILL-01, OPS-04 PASS; dormant-AI `/ai` FAIL (fixed); TEN-*, PERM-* BLOCKED (one tenant, one role); the rest NOT_RUN | NOT RECORDED. Observations O-1 (503s on server actions and RSC reads; **probably related to INC-93-S9, "pool timeout answers 503 + Retry-After", and DEF-PC-022; unproven**) and O-2 (audit-log noise) need a retest. QA test product `QA Flow PROD-01 Cotton Tee` still exists, `draft` |
| Production Certification `VEXA-PROD-CERT-2026-10-02-01` (INC-84, INC-93) | PARTIAL: INC-84-S1 and S5 open (S5 a blocked spike); INC-93-S3, S4, S8, S9 in progress; the rest completed and locked | DEPLOYED where stated in the lock file | per-story live checks in `INCREMENT_STATE.json` | open defects DEF-PC-022 (bimodal latency, intermittent 500s), DEF-PC-024 (shared IP buckets), DEF-PC-025 (P0/P1 alerts reach no human) |
| GA readiness decision (`GA_RELEASE_READINESS_DECISION_2026-09-12.md`) | document DONE | n/a | n/a | `pending-signoff`: all five role rows PENDING since 2026-09-12 |
| WooCommerce launch stage (INC-95, #1180) | DONE | DEPLOYED | CI test asserts `p1_blocker_hold` | `p1_blocker_hold` is current; the 2026-10-03 advance to `early_access` (#1052, #1059) is **historical and superseded**. Its closure criteria include production RLS evidence, so it also waits on the cutover |

## 6. Conflicts recorded (not silently resolved)

| # | Conflict | Treatment |
|---|---|---|
| C1 | Gate A formally REWORK while AI foundation work (including schema) merged afterward | Retrospective disposition record, owner blank; **no rewrite, no revert** of the merged work |
| C2 | `INCREMENT_STATE.json` last updated 2026-10-05, no SEC-DB-RLS-001 or AI increment | Repaired in this PR (new unlocked increments); nothing locked |
| C3 | WooCommerce `early_access` (2026-10-03) versus `p1_blocker_hold` on `main` | `main` and INC-95 are authoritative |
| C4 | GA readiness sign-offs pending since 2026-09-12 | HUMAN_GATED; unchanged |
| C5 | `/ai` repair exposure was already filed 2026-10-03 as MB-001 and GAF-014; #1236/#1238 closed the exposure only | GAF-014 stays open |
| C6 | Gate A evidence files cited in the issues (`docs/vexa-ai-001/...`) are absent from this repository's history | recorded; evidence unreachable from this repo |
| C7 | A validator requires the literal `forEachTenant(` (`validate-ai-prov-provider-execution-eligibility.cjs`) | any helper rename must update the validator; no rename now |
| C8 | Several programmes overlap (RLS, Gate A, AI, Production Certification, GA, QA, Stream B) | this document is the index; sections 3 to 5 |

## 7. Release posture (owner decisions, 2026-10-08)

| Question | Posture |
|---|---|
| Current PIM, controlled/pilot operation | GO_WITH_CONDITIONS |
| Broad GA | **HOLD** |
| Restricted-runtime production cutover | **HOLD** (CUTOVER_BLOCKED; blockers in section 8) |
| AI 004b-ii | **HOLD**, sequenced **after** the restricted-runtime cutover |
| First provider call | **NO-GO** |
| Gate B | **NOT HELD** |

Cutover blockers: remaining class-A jobs and class-C resolutions; 7.2a runtime proof and 7.2b; M1c; restricted runtime, migrator, backup and (as required) reporter/ops credentials; a real backup restore; a rollback rehearsal; the final restricted-runtime rehearsal; branch protection or an owner-accepted equivalent (upgrade, an externally enforced merge control, or an explicit Security + CTO + SRE risk acceptance); Security and SRE sign-off. `vexa_app_v2` is **not** to be demoted or modified in place: the strategy is a new restricted credential, cut over, observe, roll back by credential/config switch.

## 8. Single dependency graph

```text
Governance reconciliation (this document)
        ↓
Remaining RLS call sites (class A, class C, M1c)
        ↓
AI maintenance runtime proof (7.2a positive result)
        ↓
Drop maintenance policies (7.2b)
        ↓
Identity / credential provisioning
        ↓
Restore + rollback proof
        ↓
Final restricted-runtime rehearsal
        ↓
Security / SRE cutover review
        ↓
Production restricted-runtime cutover   [HUMAN-GATED]
        ↓
Post-cutover certification
        ↓
004b-ii authorization
        ↓
Provider adapter / network zone
        ↓
Dormant proof → Kill-switch drill
        ↓
Provider key + hard cap   [HUMAN-GATED]
        ↓
First controlled provider request
        ↓
FULL Golden Catalog evaluation
        ↓
Gate B

PARALLEL HUMAN TRACK (does not wait for the cutover; independent of implementation authorization):
Gate A disposition · Security approval · Privacy approval · FinOps approval · Provider/model approval ·
64 Golden Catalog approvals · legacy-AI disposition · QA Acceptance Lane · MEDIA_URL_SIGNING_KEY activation decision
```

Each migrated RLS job needs: seed a non-default tenant, execute as the restricted role, a **positive non-empty result**, and a mutation/revert check. A test that merely does not throw is insufficient.

## 9. DO NOT START register

| Category | Items |
|---|---|
| Already merged (do not redo) | tenant-iteration helpers; 7.2a; credential rotation; provisioning seed; billing jobs; explicit-tenant SQL; signed media D1/D1b; M1a/M1b; 7.8; 7.9a/b/c; 7.10 plan; Stream B packs and runbooks; AI Surface Census; `/ai` flag gate |
| Awaiting verification | 7.2a runtime positive result; `/ai` API and server-action gates at runtime; 7.9 credentials; restore on a real backup |
| Human-gated | provider key; `MEDIA_URL_SIGNING_KEY`; kill-switch drill; first provider call; cutover; every sign-off and approval; Gate A disposition |
| Superseded | the B0 and r2 ledgers (use this document); the parked `forEachTenantInTransaction` rename |
| Must not be created | a third tenant-iteration abstraction; any provider SDK or network code; any non-zero AI budget; a new Gate document duplicating Gate A or Gate B; any change to `vexa_app_v2` in place |
| Held until after the cutover | 004b-ii implementation, the network-guard transition, the dormant-proof refresh, the drill |

Before starting anything not listed here, re-read `origin/main`, the open PRs, and this document.

## 10. Re-check before relying on this document

`origin/main` head and exact-head CI/deploy; open PRs touching `docs/execution/`; the identity state in production (last evidence 2026-10-06); the Railway variables for both services (including `APP_ENV` and the AI flags), which this record could not read; whether Gate A has a recorded disposition; the lock file (`INCREMENT_STATE.json`), which is updated in this PR and must be kept current as stories complete.
