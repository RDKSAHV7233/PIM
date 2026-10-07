# Gate A retrospective disposition record (VEXA-AI-001)

Date prepared: 2026-10-08
Baseline: `origin/main` at `731c4ec4`
Type: **decision record template with evidence. It records history and proposes a classification of each original blocker. It does not decide anything.**
Status: **Gate A remains historically REWORK until the named decision owner records otherwise.** Nothing in this document closes, supersedes or approves Gate A, and no merged code is rewritten or reverted because of it.

## 1. Purpose

The formal Gate A record says REWORK, but AI-CORE, AI-POL, AI-EVAL and AI-PROV work (including schema migrations) merged afterward. That does not make the later work invalid. It means the programme has no trustworthy governance history until the discrepancy is explicitly reconciled. This record repairs the chain **without falsifying history**: it states what Gate A said, what happened next, and which original blockers are resolved, still open, superseded, or migrated to Gate B. A named human owner then records the formal disposition.

## 2. Historical state (as recorded in GitHub; not edited)

| Fact | Evidence |
|---|---|
| All four required lanes recorded **REWORK** | Security #1084, CTO #1076, QA #1082, PO #1079: each "Gate A decision: REWORK", labelled "owner-directed", **2026-10-04 04:36 UTC**, baseline `origin/main 6543ebd6` |
| By 2026-10-04 05:05 UTC "Gate A remains blocked only by repository governance enforcement" (RG-003) | RG-003 owner-action comment on #1076 and #1082; the earlier deploy-staging failure (RG-002) had been revalidated green at 05:01 UTC |
| The decisions said: do not start AI-CORE, schema work, provider integration or AI feature implementation | the lane decisions above |
| Subsequent engineering | first AI PRs merged **2026-10-04 12:50 UTC** (#1132, #1133), schema migrations from 2026-10-04 16:30 UTC (`20261004163000_ai_execution_telemetry` onward), through AI-PROV-004b-i (#1181, 2026-10-05 23:24 UTC) |
| Gate A issues since | still open (#1075 to #1109); no later decision comment found; no closure |
| Gate A evidence files cited in the issues (`docs/vexa-ai-001/evidence/...`) | **not present in this repository's history**; unreachable from here |
| Open PRs requiring "disposition" at the time (#1029, #951, #877) | still open |

## 3. Original blockers and their current status

"Proposed classification" is the author's reading of evidence on `main` and in GitHub as of 2026-10-08. **It is a proposal for the owner and is not a decision.**

| Original blocker | Evidence now | Proposed classification |
|---|---|---|
| RG-002: deploy-staging post-deploy smoke failure (`workflow_submit_for_review` PATCH returned 500) | revalidation run `37178177771` on `7fdc9f16` succeeded 2026-10-04; every later exact-head deploy checked since has succeeded | **resolved** |
| RG-003 / GAF-010 (#1075, #1081, #1102): branch protection or required-check enforcement not observed | 2026-10-07: `protected=false`, protection API 404, rulesets 403 "Upgrade to GitHub Pro or make this repository public"; no CODEOWNERS; also a blocker for the restricted-runtime cutover | **still open** |
| MB-001 / GAF-002 / GAF-011: AI-adjacent direct canonical Product write at `auto-suggestions.service.ts:70` | Security lane dispositioned MB-001 as `EXCLUDE_FROM_AI_001` (2026-10-04); #1238 gates the page, the repair server action and `apply=true` behind an explicit fail-closed flag (deployed; `/ai` live check shows "Page not found" for an Admin; the API gate and action were not exercised live) | **exposure resolved; governance finding open** |
| GAF-014 (#1098 UX, #1090 PO): the AI Labs repair UX applies a suggested repair without accept/edit/reject governance | #1238 closes the *exposure*, not the missing governance model | **still open** (migrated to a later gate by its own issue: Gate C) |
| GAF-004 (#1077), GAF-008 (#1078), #1106: no production AI-enrichment claims; AI Labs naming may confuse stakeholders about production readiness | claims wording unresolved; the legacy Labs surface still exists behind the flag | **still open** |
| GAF-012 / GAF-007 (#1096, #1092, #1095, #1091, #1104): provider data classification enforced before any model call; tenant opt-in, retention, deletion, DPA, subprocessors, region | classification and policy implemented (AI-POL-001, -002, -003 merged); Privacy decisions P1 to P11 prepared but **unsigned** | **migrated to Gate B** (implementation resolved; approvals pending) |
| GAF-005 / GAF-013 (#1087, #1088, #1089, #1097): cost visibility; AI-specific kill switch, provider budget controls | implemented in the 004b-i control plane (budgets, reservations, kill switch, BIGINT money); kill-switch drill and live evidence **not done** | **migrated to Gate B** |
| GAF-001 / GAF-006 (#1093, #1094): rule-based suggestions lack evaluation signal and semantic provenance | governed provenance contract and the FAST evaluation harness exist; **FULL evaluation never run**; Golden Catalog 64/64 DRAFT | **partly superseded by newer architecture; remainder migrated to Gate B** |
| GAF-009 (#1080): story completion versus evidence | not re-examined in this record | **not assessed; owner to classify** |
| Tenant-isolation evidence for AI paths (Security advisory blocker) | production runtime is still a superuser as far as evidence shows; 7.2a merged, runtime proof and 7.2b pending | **still open (SEC-DB-RLS-001, Stream A)** |
| Required sign-offs: Security #1084, CTO #1076, QA #1082, PO #1079; supporting reviews Privacy #1085, SRE #1086 | REWORK recorded 2026-10-04; nothing later | **pending** |
| Role-coverage issues #1102 to #1109 (REPO-ADMIN, TENANT-RBAC, SCRUM-MASTER, PIM-SME, CLAIMS-MARKETING, TENANT-PRODUCT, LEGAL-DPA, PRODUCT-SERVICE) | open | **still open** |
| Open PR dispositions #1029, #951, #877 | still open, unrelated to the AI programme | **still open** |

## 4. Disposition options (listed as text; none is selected)

- SUPERSEDED
- PARTIALLY SATISFIED
- REWORK REMAINS
- CLOSED_WITH_CONDITIONS

For each original blocker the owner may also record: resolved / still open / superseded by newer architecture / migrated to Gate B (as in section 3).

## 5. Author proposal and formal decision

Author proposal (a proposal only, not operative): PARTIALLY SATISFIED

Formal disposition: [blank]

Decision owner: [blank]

Decision date: [blank]

Conditions or rationale recorded by the owner: [blank]

## 6. What the formal disposition does not change

It does not approve provider integration, 004b-ii, any budget, any tenant, any provider key or any Golden Catalog case. Those remain governed by their own gates: the restricted-runtime cutover, the Security, Privacy, FinOps and provider decisions, the Golden Catalog approvals, the dormant proof, the kill-switch drill and Gate B (`NOT HELD`).

## 7. After a decision is recorded (separate human-approved step)

Post the disposition link and the owner's decision as a comment on the Gate A sign-off and blocker issues (#1084, #1076, #1082, #1079, #1081, #1102). That is an outward-facing action and is **not** part of the pull request that adds this document.
