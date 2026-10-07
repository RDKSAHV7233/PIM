# Vexa AI programme ledger, current status (r2)

Date: 2026-10-07
Baseline: `origin/main` at `ecbce248` (#1231)
Type: **documentation only.** A status synchronisation. No runtime code, no production access, no provider path, no credential, no approval.
Status: **this is the single current status source for the AI programme and supersedes `vexa-ai-programme-ledger-2026-10-07.md` (the B0 snapshot, written at `ec9b166c` and updated at `a475cc0f`).** The B0 document stays as history; its rows are out of date.

## 1. How to read this ledger

| State | Meaning |
|---|---|
| `DONE / MERGED` | merged on `main`; evidence is the PR and file named |
| `DECISION-READY` | a merged **packet, plan or runbook** that prepares a decision. **It is not the decision.** Nothing in it is approved, signed or in force until the named owner records the decision in their own name |
| `AWAITING HUMAN SIGN-OFF` | a decision-ready packet whose owner has not yet decided |
| `HUMAN-GATED` | needs a human decision or a production action that no agent may supply |
| `BLOCKED` | cannot start until a named predecessor completes |
| `ACTIVE` | an open PR or named owner is working it; **do not touch** |
| `NOT HELD` / `NOT CREATED` / `NOT CONFIGURED` | the event has not happened |

**A merged decision packet is not an approval.** Later sessions must not read "merged" on a Stream B document as "decided". The sign-off blocks inside each pack are blank by design.

## 2. Two streams, one boundary (unchanged)

- **Stream A:** SEC-DB-RLS-001 and everything numbered in the Sprint 6 to 12 plan: tenant iteration, runtime/migrator/backup/reporter/ops identities, deployment wiring, rehearsal, role cutover, Stage 2, publication targets. Reconciliation: `sec-db-rls-001-stage1-reconciliation-2026-10-07.md` (#1215).
- **Stream B:** AI approvals, governance, provider readiness, evaluation and Gate B preparation: the documents in section 4.
- **Non-conflict rule:** before any implementation PR, fetch `origin/main`, list open PRs and check for overlap in files, services, migrations, validators, workflows and design decisions. If another PR owns the area, stop that task. An old backlog item is not proof that work remains; current `main` is authoritative.
- **Repository:** `Mixwage/PIM` (the former `Vexaapps/PIM` and `RDKSAHV7233/PIM` redirect to it). Always pass `--repo Mixwage/PIM`. Note that the author account shown on PRs (`RDKSAHV7233`) is the CLI login used by this environment and **cannot identify which stream or session produced a PR**.

## 3. Current status

| Area | Status | Evidence / note |
|---|---|---|
| B0 to B12 (Stream B) | **DONE / MERGED** | #1216 to #1230; register in section 4 |
| Signed-media activation runbook | **DONE / MERGED. Activation not performed.** | #1231, `docs/runbooks/media-signing-activation-runbook.md` |
| `MEDIA_URL_SIGNING_KEY` | **HUMAN-GATED / UNSET** | production change; prerequisite of the restricted-role cutover; pre-flight in the runbook (storage mode, unsigned URLs already issued, token expiry) |
| Security decision pack (15 topics) | **DECISION-READY. AWAITING HUMAN SIGN-OFF** | #1220; four new findings (F-1 to F-4) |
| Privacy decision pack (P1 to P11, G1, G2) | **DECISION-READY. AWAITING HUMAN SIGN-OFF** | #1221 |
| FinOps limits | **DECISION-READY. AWAITING HUMAN SIGN-OFF** | #1223; no budget exists; database defaults are zero |
| CTO provider and model decision | **DECISION-READY. AWAITING HUMAN SIGN-OFF** | #1222 recommends Anthropic first-party, `claude-sonnet-5-5`, US-pinned, `product_attribute_extraction`; not approved |
| Golden Catalog, 64 cases | **DRAFT. HUMAN APPROVAL REQUIRED** | #1218, #1219 packets; **0 of 64 authoritative**; the status matrix is a snapshot |
| Provider key | **NOT CREATED / HUMAN-GATED** | runbook #1224; no agent may handle the key |
| Provider-side spend cap | **NOT CONFIGURED / HUMAN-GATED** | #1223; enforcement behaviour (stop or notify) unverified |
| AI-PROV-004b-ii (adapter zone) | **BLOCKED ON STREAM A + GOVERNANCE** | design #1225; implementation needs the readiness signal and the decisions above |
| Network-guard transition | **BLOCKED WITH 004b-ii** | plan #1226; today network code is forbidden everywhere and the guards are unchanged |
| Dormant-state proof refresh | **BLOCKED ON RESTRICTED-RUNTIME STATE** | runbook #1227; the last production proof was taken as a superuser |
| Kill-switch drill | **HUMAN-GATED** | runbook #1228 (held); two script defects recorded; operator access and rehearsal undecided |
| First provider call | **HUMAN-GATED / BLOCKED** | needs everything above |
| FULL evaluation | **BLOCKED ON APPROVED CATALOG + LIVE PROVIDER** | spec #1229; the key location for FULL runs is an open Security decision |
| Gate B | **NOT HELD** | pack #1230; reviewer verdicts blank; no review has taken place |
| Stream A #1232 (7.9a migrator wiring) | **ACTIVE. DO NOT TOUCH** | open at the time of writing |
| Production database role cutover | **STREAM A / HUMAN-GATED** | RLS-5; Security, CTO, restore test, rollback rehearsal, new credential |
| GitHub required-check enforcement | **BLOCKED BY PLAN / GOVERNANCE DECISION** | the plan could not enforce branch protection or required checks (checked 2026-10-06); re-check after the repository move |
| RLS merged work already on `main` | DONE / MERGED (Stream A's record) | #1204 to #1215, #1214 (7.2a); 7.2b not started, waits on runtime verification |

## 4. Stream B artifact register (all `DONE / MERGED`; all `DECISION-READY`, none approved)

| Item | PR | Document |
|---|---|---|
| B0 ledger (superseded by this document) | #1216 | `docs/qa/vexa-ai-programme-ledger-2026-10-07.md` |
| B1 Golden Catalog review packets (QA, Security), status matrix, generator and validator | #1218 | `ai-eval-review-packet-qa-2026-10-07.md`, `ai-eval-review-packet-security-2026-10-07.md`, `ai-eval-approval-status-matrix-2026-10-07.md`, `scripts/render-ai-eval-review-packets.cjs`, `scripts/validate-ai-eval-review-packets.cjs` |
| B1 PIM SME packet | #1219 | `ai-eval-review-packet-pim-sme-2026-10-07.md` |
| B2 Security decision pack | #1220 | `ai-security-decision-pack-2026-10-07.md` |
| B3 Privacy decision pack | #1221 | `ai-privacy-decision-pack-2026-10-07.md` |
| B4 provider and model selection | #1222 | `ai-provider-model-selection-pack-2026-10-07.md` |
| B5 FinOps configuration | #1223 | `ai-finops-configuration-pack-2026-10-07.md` |
| B6 credential runbook | #1224 | `docs/runbooks/ai-provider-credential-runbook.md` |
| B7 004b-ii final design | #1225 | `ai-prov-004b-ii-final-design-2026-10-07.md` |
| B8 network-guard transition plan | #1226 | `ai-network-guard-transition-plan-2026-10-07.md` |
| B9 dormant-state proof runbook | #1227 | `docs/runbooks/ai-dormant-state-proof-runbook.md` |
| B10 kill-switch drill runbook | #1228 | `docs/runbooks/ai-kill-switch-drill-runbook.md` |
| B11 FULL evaluation specification | #1229 | `ai-full-evaluation-specification-2026-10-07.md` |
| B12 Gate B decision pack | #1230 | `ai-gate-b-decision-pack-2026-10-07.md` |
| Signed-media activation runbook | #1231 | `docs/runbooks/media-signing-activation-runbook.md` |

The Golden Catalog validator is part of the `validate-ai-*` CI gate; the packets go stale only if the catalog content hash changes, not when an approval is recorded.

## 5. Do not start

```text
Do not start independently:
- outbound-webhooks RLS recovery
- plan-usage RLS work
- remaining RLS sweepers
- M1c constructor migration
- tenant-helper rename / convergence
- migrator / runtime / backup identity wiring
- 004b-ii
- network-guard implementation
```

These belong to Stream A or are explicitly gated. Also do not: set any flag, create a provider key, set a budget, enable a tenant, run the kill-switch drill, send a provider request, edit a Golden Catalog case or its approval, or change an AI validator or guard, without the named human authorisation. The parked rename (`forEachTenantInTransaction`) is abandoned for now; if it is revived it must keep `forEachTenant` or update the AI governance validator that requires the `forEachTenant(` call.

## 6. Next-unblock chain

```text
Stream A completes the restricted-runtime boundary
        +
Security approval
Privacy approval
FinOps / CTO provider-model approval
Golden Catalog approvals
        ↓
MEDIA signing activation and proof, where required
        ↓
004b-ii implementation authorisation
        ↓
dormant-state proof
        ↓
kill-switch drill
        ↓
human-provisioned provider key + provider-side cap
        ↓
first controlled provider call
        ↓
FULL evaluation
        ↓
Gate B
```

Only the human decisions and Stream A's completion move the programme. No Stream B engineering is started until the first gates close.

## 7. Findings carried by the packs (read the packs; summarised only)

- No detector or vector exists for Vexa's own API-key format `pim1_<id>.<secret>`; no CODEOWNERS file and no enforceable review on this plan (Security pack).
- No personal-data detection on allowed free text; AI tables are in no deletion path (Privacy pack).
- Haiku 4.5 cannot take `inference_geo`; Fable and Mythos models are Covered Models without zero data retention (provider pack).
- No operator command exists to set a budget or turn the kill switch on; `vexa_ops` is the planned identity and is not provisioned (FinOps pack, credential and drill runbooks).
- The kill-switch drill cannot pass as written since #1214, and its single-connection design does not fit the `vexa_runtime` / `vexa_ops` grants (drill runbook).
- The current network guards miss `const f = fetch` aliases and several Node modules (transition plan).
- A FULL runner cannot be a GitHub workflow if the provider key lives only on the API service (FULL specification).
- Connector payloads use the signed media route only in local-filesystem storage mode; token expiry affects external consumers (media runbook).

## 8. Operational note

GitHub Actions was billing-blocked from about 09:29 to 10:56 UTC on 2026-10-07; runs in that window failed without starting. Deploy Staging succeeded for `ecbce248`; every commit merged during the window was documentation or CI tooling, so the deployed API and web app were unchanged.

## 9. What this document does not do

It approves nothing, records no sign-off, holds no gate and changes no code, flag, budget, key or tenant. It does not touch Stream A's work.
