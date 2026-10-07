# Gate B decision pack: Intelligence Platform Safe (Stream B, B12)

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f`
Type: **documentation only.** This builds the structure of the gate while engineering continues. **Gate B has not been held and is not passed.** No reviewer has signed anything.
Status: **proposal / awaiting human approval.** The gate's contract (sections 1 to 4) is a proposal for the CTO to adopt; the repository defines no Gate B for the AI programme (`ai-eval-investigation-2026-10-05.md`, finding 6, said so and left the consumer contract as an open CTO and QA decision). The only other "Gate B" documents in the repository are unrelated programme gates.

## 1. What the gate decides

**Gate:** *Intelligence Platform Safe.* The question is: is the governed AI platform safe to receive its first controlled live-provider traffic and to progress to a pilot? It is a **safety** gate. It is not a quality gate for model output (that is the FULL evaluation, B11, whose thresholds do not exist yet) and not a launch decision.

**It cannot be held until** the live-provider path exists and has been exercised under control: 004b-ii merged, the dormant-state proof and kill-switch drill recorded, and at least one authorised FULL baseline. Until then the pack is a template with the current evidence state recorded honestly.

## 2. Reviewers and authority

| Reviewer | Signs | Source |
|---|---|---|
| **CTO / Architecture** | structural and reliability thresholds; final technical acceptance of the gate | `ai-eval-investigation` section 8 |
| **Backend** | the implementation matches the design; defects the evidence surfaces are fixed | same |
| **Security** | safety thresholds; boundary, credential, redaction and tenant-isolation evidence | same |
| **QA / AI Evaluation** | the evaluation evidence and its interpretation | same |

PIM SME signs factual and evidence thresholds when they exist. Privacy confirms the data-processing decisions (B3). No agent, script or other reviewer signs for any of them.

## 3. Allowed decisions

| Decision | Meaning | Rule |
|---|---|---|
| `GO` | all eleven criteria have reviewer-recorded evidence that meets the stated bar | every row in section 5 has a verdict and every verdict is `MET` |
| `GO_WITH_CONDITIONS` | the platform may proceed; named conditions remain | conditions never weaken a **safety** criterion (tenant isolation, kill switch, payload and redaction policy, adapter boundary, no Product write, safety results); each condition has an owner and a date; a condition on a non-safety row (for example cost capture detail) is allowed |
| `REWORK` | evidence exists but is insufficient or a defect was found | the failing rows and the required changes are listed; the gate is re-held after them |
| `NO_GO` | a safety criterion is unmet, or evidence is missing for any row | any non-zero safety result, any row with no evidence, or tenant isolation not certified forces `NO_GO` |

**The gate is never marked passed before an actual review, and never by anyone but the four reviewers.**

## 4. How a review is run

1. **Freeze.** The reviewers agree one commit SHA of `main` and the evidence set for it; evidence is linked by PR number, document and hash, not copied.
2. **Assemble** section 5 for that SHA: for each row, the evidence, who produced it, when, and the reviewer verdict (`MET`, `NOT MET`, `PARTIAL`) with notes.
3. **Review independently.** Each reviewer completes their rows before seeing the others' verdicts; disagreement is recorded, not smoothed.
4. **Decide** per section 3, in a recorded meeting or pull request; record conditions with owners.
5. **Re-gate triggers:** a change of provider, model, prompt, schema or payload policy; any change to the adapter zone or the control plane; a change of the production database role or identity; a safety result above zero; a Security or Privacy decision being reversed.

## 5. The evidence matrix

"Evidence available" is the author's reading of `main` at `a475cc0f` and the Stream B documents; it is **not a verdict**. The reviewer column is blank by design.

| # | Criterion | Bar (proposed) | Evidence available today | Evidence still needed | Reviewer(s) | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Tenant isolation certification** | restricted runtime role in production; RLS-4 exit criteria met on synthetic non-default tenants (0 unexplained failures, 0 unexpected empty results, 0 privileged fallbacks, 0 runtime BYPASSRLS or ownership dependencies, 0 unclassified cross-tenant maintenance paths); AI paths included | restricted-role CI lane (30 tests, empty baseline); AI sweeper and audit on tenant iteration (#1214, merged, not yet runtime-verified); **production runtime role is still a superuser** (RLS bypassed) | role cutover (human-gated), 7.2b after runtime verification, RLS-4 rehearsal, dormant proof re-run as the restricted role | Security, CTO, Backend | [ ] |
| 2 | **Provider adapter boundary** | one directory is the only network path; zone validator and negative tests green; no SDK; one credential-source function | design only (B7, #1225); transition plan (B8, #1226); today network code is forbidden everywhere and enforced by validators | 004b-ii-a merged with the zone validator (Z1 to Z9, I1 to I4) and the 20 negative tests | Security, Backend | [ ] |
| 3 | **Payload and redaction policy** | field classification approved; secrets blocked with no override; personal data in allowed free text decided; first-capability field list fixed | policy mechanism and fixture implemented (AI-POL-001/2/3); FAST blocks 4 of 4 blocked payloads; Privacy pack (B3, #1221) lists the open decisions and two gaps | Privacy decisions P1 to P11 recorded; Security decision on detection coverage (the `pim1_` key format, B2 F-1); the free-text personal-data decision (B3 G1) | Security, Privacy | [ ] |
| 4 | **Kill switch** | control row deny-all by default; drill passed and recorded; pre-dispatch recheck and discard-on-kill proven; hard-stop procedure rehearsed by a named operator | control row, gates, recheck and discard implemented and unit and integration tested (#1181); production dormant proof taken under a superuser (#1185); drill runbook prepared and **held** (B10, #1228) with two script defects recorded | the drill (human-authorised), the script fixes, the operator access and rehearsal | Security, Backend, CTO | [ ] |
| 5 | **Budgets** | zero defaults; four atomic counters plus per-request cap; ambiguous billing settles at the estimate; provider-side limit set and its enforcement verified; reconciliation running | lifecycle implemented with a real-PostgreSQL concurrency suite (#1181); FinOps pack (B5, #1223) with proposals, an empty non-billable allow-list, and the missing operator command recorded | approved numbers, provider limit set and its stop-or-notify behaviour verified, the operator command, one reconciliation against provider usage | CTO, Backend (FinOps informed) | [ ] |
| 6 | **Structured output** | provider output validated by the Vexa validator, which stays authoritative; refusal and truncation map to non-completed finish statuses | validator and adapter contract implemented (#1153, #1155, #1158); mapping designed (B7 section 5) | live adapter implemented and exercised; FULL structural metrics (B11 5.1) | QA, Backend | [ ] |
| 7 | **Provenance** | every accepted suggestion carries valid evidence whose cited field contains the value | provenance contract and validator (#1140); FAST evidence coverage and validity 158/158 against the replay adapter | FULL evidence metrics on a live model (B11 5.3) | QA | [ ] |
| 8 | **Golden Catalog** | the cases used for authoritative scoring are approved by PIM SME, QA and (adversarial) Security | 64 cases, **all `DRAFT`**; review packets and status matrix prepared (B1, #1218 and #1219): **0 of 64 authoritative** | the human approvals, in their own names | PIM SME, QA, Security | [ ] |
| 9 | **Cost capture** | actual cost recorded per execution from provider usage and a pinned price table; per-case and per-accepted-suggestion cost reported | fields and `BIGINT` accounting implemented (#1181); cost model with stated assumptions (B5) | real executions measured; estimate-versus-actual accuracy | CTO, QA | [ ] |
| 10 | **Safety results** | FULL safety axis exactly zero on every safety metric, including tenant leakage and policy bypass | FAST safety 0 violations and 4 of 4 blocked payloads, with zero provider calls (machinery evidence only); FULL specified (B11, #1229) | an authoritative FULL baseline; the missing catalog cases (credential-shaped rejection, tenant-leakage probe) | Security, QA | [ ] |
| 11 | **No direct Product write** | no Product, Catalog, Quality or AutoSuggestions import; no write route; suggestions enter as `pending_review`; no autonomous publish | guard and validators implemented and unchanged by the transition plan (#1133, `validate-ai-sec-no-direct-product-writes.cjs`); invariant kept in every Stream B design | confirmation that 004b-ii leaves it unchanged (validator evidence in the PR) | Security, Backend | [ ] |

**Author's observation (a status, not a decision):** on today's evidence most rows lack what the bar needs: tenant isolation is not certified, the adapter boundary and the live path do not exist, the kill-switch drill and the FULL baseline have not been run, and no Golden Catalog case is approved. A review held now could only return `NO_GO` or `REWORK`. That is the expected state of a programme that has deliberately not started provider integration.

## 6. Evidence index (all linked, none copied)

| Artifact | Where |
|---|---|
| Programme ledger | `docs/qa/vexa-ai-programme-ledger-2026-10-07.md` (#1216) |
| Golden Catalog review packets and status matrix | `ai-eval-review-packet-*-2026-10-07.md`, `ai-eval-approval-status-matrix-2026-10-07.md` (#1218, #1219) |
| Security decision pack | `ai-security-decision-pack-2026-10-07.md` (#1220) |
| Privacy decision pack | `ai-privacy-decision-pack-2026-10-07.md` (#1221) |
| Provider and model selection | `ai-provider-model-selection-pack-2026-10-07.md` (#1222) |
| FinOps configuration | `ai-finops-configuration-pack-2026-10-07.md` (#1223) |
| Credential runbook | `docs/runbooks/ai-provider-credential-runbook.md` (#1224) |
| 004b-ii final design | `ai-prov-004b-ii-final-design-2026-10-07.md` (#1225) |
| Network-guard transition plan | `ai-network-guard-transition-plan-2026-10-07.md` (#1226) |
| Dormant-state proof runbook | `docs/runbooks/ai-dormant-state-proof-runbook.md` (#1227) |
| Kill-switch drill runbook | `docs/runbooks/ai-kill-switch-drill-runbook.md` (#1228) |
| FULL evaluation specification | `ai-full-evaluation-specification-2026-10-07.md` (#1229) |
| RLS stream | `sec-db-rls-001-stage1-reconciliation-2026-10-07.md` (#1215, merged) and the Sprint 6 to 12 plan |

(PR numbers are as opened on 2026-10-07; the documents are authoritative once merged.)

## 7. Decision record (blank; completed at the review, by the reviewers only)

| Field | Value |
|---|---|
| Frozen commit SHA and evidence set hash | |
| Review date; reviewers present (CTO, Backend, Security, QA) | |
| Decision (`GO` / `GO_WITH_CONDITIONS` / `REWORK` / `NO_GO`) | |
| Conditions (each with owner and date) | |
| Rows with verdict `NOT MET` or `PARTIAL`, and the change required | |
| Re-gate trigger acknowledged | |
| Signatures (name, role, date) | |

## 8. What this pack does not do

It holds no review, records no verdict, marks nothing passed and signs for nobody. It adds no code, validator, flag, budget, key or provider path. It does not predict the decision. It does not replace the CTO's adoption of the contract in sections 1 to 4.
