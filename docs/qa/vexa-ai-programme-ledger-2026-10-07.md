# Vexa AI programme ledger (Stream B, B0)

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f` (updated after #1214 merged; first written at `ec9b166c`)
Type: **documentation only.** No runtime code, no production access, no provider path, no credential.
Status of this document: **SUPERSEDED by `vexa-ai-programme-ledger-2026-10-07-r2.md`**, which is the single current status source. This file is kept as history; its status rows are out of date. It records state; it approves nothing.

## 1. Two streams, one boundary

| Stream | Owns | Source of truth |
|---|---|---|
| **A: RLS, database identity, publication targets** | SEC-DB-RLS-001 (#1189), Stage 1 slices 7.x to 9.x, tenant-iteration implementations, deployment DB identity, rehearsal, role cutover, Stage 2, publication-target Sprints 10 to 12; active PR #1214 | the Sprint 6 to 12 plan and `docs/qa/sec-db-rls-001-stage1-reconciliation-2026-10-07.md` (#1215) |
| **B: AI governance and provider readiness** | approvals, decision packets, runbooks, specifications, evaluation, Gate B preparation | this ledger |

Stream B does **not** edit: `tenant-iteration.ts`, `tenant-iteration.service.ts`, `WorkspaceDirectory` iteration, `intelligence-reservation-maintenance.service.ts` (Stream A's, as changed by #1214), any call-site migration, the identity model, the restricted-role lane, migration/backup/reporter wiring, or anything on the Stream A list. Where Stream A changes one of these, Stream B updates its *reference* here after the merge, not before.

Non-conflict check performed for this PR (2026-10-07, fresh `origin/main`; refreshed after #1214 merged): open Stream A PR is #1217 (identity model, 7.8); #1214 is merged. Unrelated: #1029 (Shopify evidence), #951 and #877 (website). This PR touches one new file under `docs/qa/`. No overlap.

An old backlog item is not proof that work remains; `main` is authoritative.

## 2. How to read the status column

`DONE` merged on `main` and evidenced. `ACTIVE` an open PR or a named owner is working it. `OPEN` not started, no blocker. `BLOCKED` cannot start until a named predecessor completes. `SUPERSEDED` replaced by merged work. `HUMAN-GATED` needs a named human decision, approval or production action that no agent may supply. `UNVERIFIED` a claim with no independent evidence in the repository.

## 3. Stream A (RLS and database): reference only

Not reproduced here. See #1215 for the slice map. Status relevant to AI readiness, as of `ec9b166c`:

| Item | Status | Note |
|---|---|---|
| Restricted-role CI lane (30 tests, empty expected-failure baseline) | DONE | #1195, #1213 |
| Identity model and rehearsal (88/88 on PG16 and PG18) | DONE | #1198 |
| Credential rotation, provisioning seed, billing jobs, explicit-tenant SQL, signed media route | DONE | #1204, #1206, #1210, #1208, #1211, #1212 |
| AI sweeper and counter audit onto tenant iteration (7.2a) | DONE (merged, **not yet runtime-verified**) | #1214 (`a475cc0f`). It also changed the AI governance validator `validate-ai-prov-provider-execution-eligibility.cjs`: the sweeper and audit must now *not* use `app.ai_maintenance` and must call `forEachTenant(`; the policies still exist in the database. Final CI and deploy for that commit were not yet visible when this was updated |
| Drop `ai_maintenance_read_*` policies (7.2b) | BLOCKED | needs 7.2a **deployed and runtime-verified with a positive result** (a non-default tenant's expired reservation is found and swept) |
| Identity model gains `vexa_reporter` and narrow `vexa_ops` backfill grants (7.8) | ACTIVE | #1217 (Stream A, open) |
| Remaining sweepers, dashboards, M1c fail-loud constructors, migrator/backup/reporter wiring, rehearsal v2 | OPEN (Stream A) | per #1215 |
| `MEDIA_URL_SIGNING_KEY` activation | HUMAN-GATED | production change; prerequisite of the role cutover |
| GitHub branch protection / required checks | HUMAN-GATED | the plan cannot enforce them; role cutover stays blocked until resolved |
| Restricted runtime role cutover (RLS-5) | HUMAN-GATED, BLOCKED | Security, CTO, restore test, rollback rehearsal, new credential |

**AI-relevant consequence:** the production runtime role `vexa_app_v2` is a superuser, so row level security does not yet protect the AI tables in production. Every AI production proof taken under that role is an application-layer proof, not a database-isolation proof. 004b-ii implementation waits for Stream A's readiness signal (section 7).

## 4. AI foundation: completed

All merged to `main`; evidence is the PR and the validator or test named.

| Capability | Status | PR / artifact |
|---|---|---|
| FAST Golden Catalog harness (64 cases) | DONE | #1161 (catalog v2 and validator), #1163 (harness, `fast-baseline.v1.json`) |
| Four independent scoring dimensions, no blended score | DONE | #1163; `apps/api/test/ai-eval/` |
| Golden Catalog categories (64 total) | DONE (as fixtures) | 12 clean_extraction, 10 messy_supplier_text, 10 security_adversarial, 8 units_specs, 6 each ambiguity, contradiction, invalid_data, missing_data; **all 64 are `DRAFT`** |
| Provider-neutral adapter contract | DONE | #1155 (AI-PROV-003), #1158 (hardening); `intelligence-adapter-boundary.ts`, `validate-ai-prov-adapter-contract.cjs` |
| Structured-output validation | DONE | #1153 (AI-PROV-002); `validate-ai-prov-output-validation.cjs` |
| Provenance contract and validation | DONE | #1140 (AI-CORE-003); `validate-ai-core-suggestion-provenance.cjs` |
| Finish-status in the adapter contract and execution record | DONE | `IntelligenceAdapterFinishStatus` in `intelligence.types.ts` (#1155/#1158) |
| Payload classification and tenant policy | DONE | #1135, #1145 (AI-POL-001) |
| Payload policy path semantics | DONE | #1165, #1167 (AI-POL-002) |
| Credential-shaped text detection | DONE, **Security confirmation open** | #1169, #1173 (AI-POL-003) |
| Payload dry-run preflight | DONE | #1150 (AI-PROV-001) |
| No direct AI write to Product | DONE | #1133 (AI-SEC-001); `validate-ai-sec-no-direct-product-writes.cjs` |
| Eligibility controls, default deny | DONE | #1175 (AI-PROV-004a) |
| Budget reservation lifecycle, platform controls, BIGINT cost accounting, kill switch (DB control row, deny-all seeded) | DONE | #1181 (AI-PROV-004b-i); migration `20261005120000` live; no caller wired to a provider |
| Control-plane proof tooling and RLS-aware proof | DONE | #1183, #1185 |
| Dormant-state proof, production, read-only | DONE with limits | #1185; verdict `DORMANT_PROVEN_WITH_UNVERIFIED`, proven under a superuser role |
| Deploy flag `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` recorded | DONE as an observation | #1186: not defined in the production service variables on 2026-10-06, so off under the strict parser. Point-in-time; re-observe before any proof that depends on it |
| Golden Catalog approval packet and approval-safe hash | DONE (packet exists) | #1171, `ai-eval-golden-catalog-approval-packet-2026-10-05.md` |

## 5. AI outstanding

| Item | Status | Depends on / note |
|---|---|---|
| Golden Catalog approvals (PIM SME, QA, Security) | HUMAN-GATED | B1 prepares the packets; no agent may mark a case approved |
| Security decision on AI-POL-003, token-prefix list owner, network boundary, telemetry, logging | HUMAN-GATED | B2 prepares the packet |
| Privacy decisions (DPA, zero data retention, training use, inference and storage geography, subprocessors, retention, data classes) | HUMAN-GATED | B3 prepares the packet |
| Provider selection | HUMAN-GATED | B4 prepares the comparison; one provider, one model, one capability |
| Model selection and version pinning | HUMAN-GATED | B4 |
| Provider-side spend cap | HUMAN-GATED | B5/B6; set by a human in the provider console |
| Vexa-side budgets (database defaults stay zero) | HUMAN-GATED | B5; pilot maxima are proposals only |
| Provider key provisioning | HUMAN-GATED | B6; no real credential in the repository, ever |
| 004b-ii (adapter zone, network) | BLOCKED | Stream A readiness signal, B2, B3, B4, B6, B7, B8 |
| Network guard transition (validators: "network forbidden everywhere" to "allowed only in the approved adapter zone") | BLOCKED | B8 plans it; implementation arrives with 004b-ii; the three 004b-i validators must not be loosened before then |
| Dormant-state proof, post-cutover rerun | BLOCKED | restricted runtime role in production; B9 prepares the runbook |
| Kill-switch drill | HUMAN-GATED, BLOCKED | explicit human authorization plus the same boundary; B10 prepares the runbook |
| First controlled provider call | BLOCKED | everything above |
| FULL evaluation (authoritative) | BLOCKED | needs approved catalog and a provider; B11 prepares the specification |
| Gate B decision | BLOCKED | needs real evidence and real reviewers; B12 prepares the structure |
| Signed-media activation runbook and smoke test | OPEN (prep only) | Stream A owns the dependency; setting the key is a human production change |

## 6. Superseded or corrected claims

- An older note that said "the AI sweeper proven under a restricted role via the `app.ai_maintenance` policy" is **not** a statement about production: production runs as a superuser. The code no longer uses the marker (#1214, merged); until 7.2b the policies still exist in the database.
- The earlier assumption that the production proof scripts could run as the deployed role without an RLS-aware design was corrected by #1185.
- "Stream B must wait for RLS before any design work": corrected. Design, packets and runbooks proceed; only **implementation** of provider networking waits.

## 7. Hand-off gate from Stream A to 004b-ii implementation

004b-ii implementation may begin only when all hold, signalled by Stream A and recorded here:

1. restricted runtime architecture certified (RLS-4 exit criteria met on synthetic non-default tenants);
2. the relevant call sites migrated, including the AI maintenance paths (7.2a merged, deployed, runtime-verified with a positive result);
3. no unresolved cross-tenant bypass path affecting AI;
4. Security, Privacy, provider/model, spend-cap and key decisions recorded by their human owners.

Until then, 004b-ii is design only (B7).

## 8. Stream B queue and independence

| # | Artifact | Touches Stream A files? | Next |
|---|---|---|---|
| B0 | this ledger | no | this PR |
| B1 | Golden Catalog approval programme (three review packets, status matrix) | no (extends the existing packet; the catalog fixture is not edited) | next |
| B2 | Security decision pack | no | after B1 |
| B3 | Privacy / data-processing decision pack | no | after B2 |
| B4 | Provider and model selection pack | no | after B3 |
| B5 | FinOps configuration | no | after B4 |
| B6 | Provider credential runbook | no | after B5 |
| B7 | 004b-ii final design | no (design only) | after B6 |
| B8 | Network-guard transition plan | no (docs and test plan only) | after B7 |
| B9 | Dormant-state proof runbook | no | after B8 |
| B10 | Kill-switch drill runbook | no | after B9 |
| B11 | FULL evaluation specification | no | after B10 |
| B12 | Gate B packet | no | after B11 |

Each is a single-subject, docs-only PR, opened and left for a human to merge.

## 9. What this document does not change

No budget becomes non-zero. No tenant is enabled. No flag is set. No provider SDK, network code or credential is added. No Golden Catalog case changes status. No Security, Privacy, QA, SME, FinOps or CTO approval is recorded or implied. The kill-switch drill and the first provider call remain held.
