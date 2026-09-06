# Vexa PIM — PR #719 Required-Team Review: Async Bulk-Publish + Plan-Limit Fixes

**Date:** 2026-09-05
**Author:** Claude Sonnet 5, acting as CTO + required-team reviewer per `docs/readiness/TEAM_SIGNOFF_MATRIX_2026-08-29.md`
**Scope:** Static code review only (8-angle multi-agent diff review + 1-vote verification pass + test-coverage audit). No live staging or browser verification performed in this pass.
**Subject:** [PR #719](https://github.com/bhoivishal216-ai/PIM/pull/719) — "feat(marketplace,billing): async bulk-publish for non-native connectors + plan-limit fixes", head `d05941cd`, base `main @ 2dadb14e` (current HEAD)

---

## Executive Call

Original verdict (2026-09-05, static review): **DO NOT MERGE AS-IS. CONDITIONAL PASS if gated behind a kill switch.**

The PR's own description already flags itself as incomplete: "Stories 9-11 (SRE rollout readiness: feature flag/canary/DLQ/runbook, security/privacy hardening, full QA pass) — not yet done, tracked as remaining backlog." This review confirmed that admission is accurate and found two of the missing pieces (feature flag, DLQ) are not cosmetic gaps — the async queue consumer this PR ships has a real, reachable bug that permanently strands work with no operator recovery path, and the test suite added by this same PR does not exercise the scenario that triggers it.

This is exactly the class of finding `docs/readiness/TEAM_SIGNOFF_MATRIX_2026-08-29.md`'s CTO/Engineering lens exists to catch before a queue-based worker reaches production traffic.

### Update (2026-09-05, same day): 3 of 6 conditions closed on the PR branch

Following this review, engineering work landed directly on PR #719's branch (`claude/vexa-commercial-readiness-9506b6`) closing conditions 1, 2, and 5:

| Condition | Status | Commit |
| --- | --- | --- |
| 1. Stuck-item recovery | **CLOSED** — `claimedAt` + reclaim-threshold query, item can no longer be permanently stranded at `queued` | `373032f7` |
| 2. DLQ / retry semantics | **CLOSED** — run is only marked `failed` once the queue backend's own retries are exhausted (`QueueHandlerAttempt`), not on the first exception | `373032f7` |
| 5. Feature flag / kill switch | **CLOSED** — `FEATURE_MARKETPLACE_BULK_PUBLISH_ASYNC_ENABLED` (default `true`, no behavior change); set to `false` to block the async path with a clear 503 without a code revert | `0557d98b` |
| 3. Native-path ceiling split | **OPEN** — Amazon's synchronous path still shares the raised 2000-item `@ArrayMaxSize` | — |
| 4. Unified plan-limit error contract | **OPEN** — bulk-edit's SKU-limit failure still doesn't surface the `PLAN_LIMIT_EXCEEDED` shape | — |
| 6. Regression test for crash/redelivery | **CLOSED** (superseded) — 5 new tests added alongside conditions 1/2/5, covering exactly this | `373032f7`, `0557d98b` |

8 new regression tests added; full `marketplace.service.spec.ts` (74 tests), `queue.service.spec.ts` (7 tests), and `env-validation.spec.ts` (6 tests) pass; `tsc -p tsconfig.build.json` is clean.

### Correction (2026-09-05, same day): PR #719 was merged before these fixes landed on it

**PR #719 merged at `2026-09-05T04:10:17Z` (merge commit `86a22266`) — before the three fix commits above were pushed to its branch.** Once a PR merges, GitHub freezes its head/CI state permanently; further pushes to the same branch land on an orphaned ref that is never incorporated anywhere. This is why the branch's CI/PR-sync appeared stuck for an extended period during this session — it wasn't a sync bug, the PR was simply already closed. **The version of the async bulk-publish feature that actually landed on `main` is the original, unfixed one** — none of conditions 1, 2, 5, or 6 were actually closed on `main` by that work.

The three fix commits were cherry-picked onto current `main` (which had advanced through PR #721 and #722 by this point) and resubmitted as **[PR #723](https://github.com/bhoivishal216-ai/PIM/pull/723)** — same fixes, same 8 regression tests, all 87 relevant tests (74 + 7 + 6) re-verified passing on top of current `main`, `tsc` clean.

**PR #723 merged 2026-09-05T16:24:34Z (squash merge, commit `ecd68a6b`).** Verified directly against `main`'s current file content (not just commit-SHA ancestry, since it was a squash merge with new SHAs): `FEATURE_MARKETPLACE_BULK_PUBLISH_ASYNC_ENABLED` is present in `env-validation.ts`, `claimedAt` is present in `schema.prisma`. **Conditions 1, 2, 5, and 6 are now genuinely CLOSED on `main`.**

`main` now has the stuck-item recovery, retry-aware DLQ marking, and kill switch.

### Update (2026-09-06): conditions 3 and 4 addressed in PR #725

- **Condition 3 (native-path ceiling)**: `NATIVE_BULK_PUBLISH_CEILING = 200`, enforced independently of the DTO's shared `@ArrayMaxSize`, in `triggerBulkPublish`'s native (Amazon) branch. A request over 200 products for a native connector is rejected with a clear, actionable `BadRequestException` before any synchronous work runs.
- **Condition 4 (unified plan-limit error contract)**: bulk-edit's `enforceSkuLimitForApproval` now throws the same `PLAN_LIMIT_EXCEEDED`/402/`upgrade_url` `HttpException` shape as catalog/marketplace. `BulkEditOperationItem` gained `errorCode`/`errorDetails` columns (new migration) to persist that structured shape from inside the async job; the bulk-edit results page (`apps/web/src/app/operations/bulk-edit/[id]/page.tsx`) now renders the same upgrade CTA every other plan-limit flow shows, via a new `getBulkEditItemPlanLimitPayload` helper.
- 9 new regression tests; `marketplace.service.spec.ts` + `bulk-edit.service.spec.ts` (95 tests), `apps/api` `tsc`, and `apps/web` `tsc -p tsconfig.lint.json` all pass.
- Submitted as **[PR #725](https://github.com/bhoivishal216-ai/PIM/pull/725)** against current `main`.
- Note: an unrelated, pre-existing test failure (`operations-bulk-edit-route-contract.test.cjs`, a different bulk-edit page than the one this PR touches) was found on current `main` during this work — not caused by, and not fixed by, PR #725. Fixed separately in [PR #730](https://github.com/bhoivishal216-ai/PIM/pull/730) (merged, squash `df9eb963`): the test only read `page.tsx`, but the structured-builder markup it was checking for had been extracted into its own client component (commit `9dfd6b10`) — genuine drift, not a real app regression.

**PR #725 merged 2026-09-05T23:59:08Z (squash merge, commit `5a66f06b`).** Verified directly against `main`'s current file content: `NATIVE_BULK_PUBLISH_CEILING = 200` is present in `marketplace.service.ts`, `errorCode: structuredError?.error ?? null` is present in `bulk-edit.service.ts`, `errorCode String?` is present in `schema.prisma`.

**Current verdict: ALL 6 ORIGINAL CONDITIONS CLOSED ON `main`.** Both PR #719's remediation (#723) and this follow-up (#725) are merged. `main` is not confirmed live-promoted to production — see the Decision Log's standing note on that.

---

## What Was Reviewed

- Full diff `main...pr719-review` (40 files, ~6,000 diff lines) via 8 independent finder passes (line-by-line scan, removed-behavior audit, cross-file caller trace, reuse, simplification, efficiency, altitude, CLAUDE.md conventions) at "high" review effort.
- Each candidate finding independently re-verified against the actual code (not just the diff) by a separate pass, with contradictions between finders resolved by direct code inspection (one alleged SKU-limit bypass was raised and then refuted this way — see Resolved/Refuted below).
- Test-coverage audit of `apps/api/src/marketplace/marketplace.service.spec.ts` (the PR's own new/changed tests) for the specific failure modes the findings depend on.

**Not done in this pass:** live staging verification, browser QA, load testing, or confirmation that any finding reproduces outside a static read of the code. Findings below are graded CONFIRMED (directly demonstrated against the actual code and call graph) or PLAUSIBLE (real risk under a realistic but unexercised condition) — no finding here should be read as "observed in production."

---

## CTO / Engineering Assessment

### Correctness — reliability of the new async queue path

| # | Finding | Verdict | File |
| --- | --- | --- | --- |
| 1 | An item claimed (`pending`→`queued`) but not completed before a worker crash is stuck at `queued` forever — no requeue path reads it, and the run can never reach a terminal state. | CONFIRMED | `apps/api/src/marketplace/marketplace.service.ts:5463` |
| 2 | The queue consumer marks the whole run `failed` on first exception, before BullMQ's own `attempts:3` retry fires; the retry then no-ops against a run already `failed`, orphaning every remaining item. No `dlqReason`/`retryCount` fields exist on the new models, unlike the existing `MarketplaceExportJob` DLQ pattern. | CONFIRMED | `apps/api/src/marketplace/marketplace.service.ts:5528` |
| 3 | The DTO's shared `@ArrayMaxSize` was raised 200→2000, but only the non-native (Shopify/WooCommerce) path was made async. The native (Amazon) path is still fully synchronous in-request — this reintroduces the original request-timeout bug the 200 ceiling existed to prevent, now reachable at up to 2000 items. | CONFIRMED | `apps/api/src/marketplace/dto/trigger-bulk-publish.dto.ts:14` |
| 4 | `excludedCount` is written via Prisma `increment` while sibling counters use `set`, and is fed by two different exclusion sources (preflight vs. worker-time) that don't reconcile against `requestedCount`. A stalled-job redelivery race (the same class of event as #1/#2) double-counts it. | CONFIRMED | `apps/api/src/marketplace/marketplace.service.ts:5577` |
| 5 | `createBulkPublishRun` does up to 2000 sequential per-row INSERTs synchronously before returning the 202 — the timeout risk moved from the publish step to the run-creation step. | PLAUSIBLE | `apps/api/src/marketplace/marketplace.service.ts:5386` |

**Test-coverage gap (material to the verdict):** `processBulkPublishRun` is exercised by 5 tests in the PR's own spec file, and every one of them calls it exactly once, start to finish, against an in-memory store, with no crash injection and no second/redelivered invocation. There is no test asserting on the `status: 'pending'` resume filter, and no test consuming the `retryEligible: true` flag the code sets on failure. Findings #1, #2, and #4 are not just present in the code — they are invisible to this PR's own regression suite by construction. This means CI passing green on this PR is not evidence against these findings.

### Product/billing correctness

| # | Finding | Verdict | File |
| --- | --- | --- | --- |
| 6 | The SKU/submission plan-limit check is copy-pasted across `catalog.service.ts`, `marketplace.service.ts` (x2), and `bulk-edit.service.ts`, and the bulk-edit copy throws a plain 400 with no `PLAN_LIMIT_EXCEEDED`/`upgrade_url` — which the frontend (`apps/web/src/lib/api/core.ts`) specifically pattern-matches to show an upgrade CTA. Worse, that exception is caught inside an async queue job and stored as a plain-text `errorMessage`, so it never reaches the HTTP layer at all. | CONFIRMED | `apps/api/src/bulk-edit/bulk-edit.service.ts:705` |

**Business impact:** a tenant who hits their SKU cap approving products via bulk-edit sees a generic "failed" job item and never sees the upgrade prompt that every other path (single-product approval, export, media upload) shows for the identical condition. This is a revenue-adjacent bug (upgrade path silently doesn't fire) shipped in the same PR that is explicitly about fixing plan-limit bypasses.

### Launch-readiness / operability

| # | Finding | Verdict | File |
| --- | --- | --- | --- |
| 7 | The new async path activates unconditionally for every non-native connector with the old synchronous path fully deleted (no fallback) and no feature flag, despite the codebase having an established idiom for exactly this (`FEATURE_STRIPE_BILLING_ENABLED`, `FEATURE_PUBLIC_SIGNUP_ENABLED`, `QUEUE_WORKER_ENABLED`). | CONFIRMED | `apps/api/src/marketplace/marketplace.service.ts:5130` |
| 8 | TC-37's "flag SSO overage instead of block" is a one-off private method in `OidcAuthService` duplicating a workflow that should be a shared `PlanUsageService` policy — other overage paths in this same PR still hard-block. Inconsistent policy shipped in one PR. | CONFIRMED | `apps/api/src/auth/oidc-auth.service.ts:152` |

### Efficiency (secondary — real, but not launch-blocking on their own)

- N+1 refetch of the same connector installation up to 3x per item, uncached, now scaled to 2000-item runs (`marketplace.service.ts:5482`).
- New `MarketplaceBulkPublishRun` list query (cursor-paginated on `updatedAt, id`) has no covering index — only `(tenantKey, status, createdAt)` and `(tenantKey, installationId)` exist (`prisma/migrations/20260904000001_marketplace_bulk_publish_run/migration.sql:46`).

### Resolved / Refuted during verification

- **Alleged SKU-limit bypass via `createVariant`/`updateVariant` on already-approved products:** REFUTED. `assertWorkflowStateAllowsContentMutation` blocks content mutation on any product in `approved`/`active` state before either method can write, and `enforceSkuLimitForApproval` re-counts all sellable variants at the moment a product transitions to approved, so pre-attaching variants to a still-draft product does not undercount. No bypass exists for the scenario raised.
- **Alleged field-normalization drift in `createOrReuseOverageFlag`:** REFUTED. Overage flags don't carry a plan-tier field by design (they represent a resource-limit breach, not a plan-tier change request); the `null` is intentional, not a dropped normalization step, and every consumer handles it.

---

## QA Lead — Live UX Verification (Addendum, 2026-09-05)

Static review above was code-only. This addendum is a live browser pass against PR #719's actual code: a disposable worktree (`pr719-review-qa`, head `d05941cd`) was run with its own API (`:4000`) and web (`:3000`) dev servers against the existing shared local Postgres/Redis, logged in as `admin@vexa-pim.local`.

**What works well:**
- The async confirm-dialog copy (Story 6) is live and reads clearly: *"This connector publishes one product at a time — queues a background run that submits an export job per approved product in the current connector workspace, instead of a single batch feed. Submitting returns immediately; track the run and each product's progress individually in the Jobs workspace."* Confirmed on the Shopify (non-native) connector's Sync tab.
- The confirm modal itself states the exact count: *"This will queue a background run to submit 1 approved product to the marketplace, one export job per product."* — correct and unambiguous.
- The new Jobs → "Bulk Publish Runs" panel renders correctly with real historical data: one completed WooCommerce run from 2026-09-04 shows `1 succeeded, 0 failed, 0 excluded of 1`, matching the panel's own description text. This is live evidence the happy path genuinely works end to end (not just in the PR's mocked unit tests).
- Submitting bulk publish against a connector with **expired credentials** (Shopify `pim584-repro`) correctly fails *before* creating a run — no zombie `MarketplaceBulkPublishRun` row was created. Good: the pre-flight check is doing its job for this case.

**New finding from this pass (not in the static review):**
- The "Submit bulk publish" button and its confirm dialog are shown as fully available on a connector whose status is **`DISABLED`** (WooCommerce `qa-woo-store`) — with no visual warning that the connector is disabled anywhere in that panel. The user has to click through the confirm dialog and submit before being told, and the resulting message is the same generic string used for every failure mode: *"Bulk publish failed. Verify products are approved, mapped, publish-ready, and that the connector is healthy."* It does not say the connector is disabled, expired, unmapped, or anything else specific — the same message appeared identically for both the disabled-WooCommerce and expired-credential-Shopify cases in this pass. An operator gets no way to tell these apart from the error alone. This is pre-existing frontend behavior, not something PR #719 introduced, but the PR touches this exact panel and didn't improve it while it was already there — worth a follow-up ticket (not a blocker for #719 itself).

**Not tested in this pass:** an actual healthy non-native connector run at scale (only 3 products exist in this local DB; the one real successful run was pre-existing data, not newly generated here), the near-2000-item soft-warning ceiling in the Products workbench selector, and any role other than Admin.

## Required-Team Table

| Team lens | Finding | Decision impact |
| --- | --- | --- |
| CTO / Engineering | 10 findings verified (8 CONFIRMED, 2 PLAUSIBLE), 2 refuted. Two CONFIRMED findings (#1, #2 above) are reliability bugs with no operator recovery path, and the PR's own tests do not exercise the conditions that trigger them. | **CTO: DO NOT MERGE AS-IS.** Conditional path exists — see Conditions below. |
| Product Owner / Commercial | Finding #6: bulk-edit SKU-cap failures don't show the upgrade CTA that this PR's stated purpose (closing plan-limit bypasses) is supposed to protect. | **PO: BLOCK** until the error contract is unified or bulk-edit surfaces plan-limit failures through the same `PLAN_LIMIT_EXCEEDED` path as every other flow. |
| SRE / Ops | Finding #7: no kill switch for a new production queue consumer; Finding #2: no DLQ/requeue mechanism, unlike the existing `MarketplaceExportJob` pattern this codebase already has. | **SRE: BLOCK** — a queue-based worker without a feature flag or DLQ is not operable; there is no way to disable it or recover a stuck run without a code revert and redeploy. |
| QA Lead | The PR's own new tests (5 `processBulkPublishRun` cases) all pass, but none exercise crash-mid-item, redelivery, or double-finalize. Live browser pass (see QA addendum above) confirms the async confirm-dialog copy and Jobs panel render correctly and the happy path works, but also surfaces a new UX gap: bulk publish can be submitted against a `DISABLED` connector with no warning and only a generic failure message. | **QA: PASS on confirm-dialog/Jobs-panel copy; INSUFFICIENT EVIDENCE on crash/redelivery** (not browser-testable without fault injection) — request regression tests for the crash/redelivery scenario, and a follow-up ticket for the generic/non-specific bulk-publish failure message. |
| Security / Privacy | No security-relevant findings identified against RBAC, tenant isolation, or credential handling in this diff. Out of scope for this pass (billing/queue logic only); no live/tenant-isolation retest performed. | Security: NOT ASSESSED (out of scope for this pass) |

---

## Conditions for a Revised Merge Decision

This is not a rewrite-from-scratch verdict — the async architecture direction is sound and most of the plan-limit fixes are correct (see Resolved/Refuted). A revised PR (or a follow-up before production traffic hits this path) should close:

1. **Stuck-item recovery** — a staleness/lock-expiry mechanism that returns a `queued` item stranded past some threshold back to `pending`, so a crashed worker cannot permanently strand a run.
2. **DLQ / retry semantics** — do not mark the run `failed` on the first exception; let BullMQ's own retry policy exhaust first, and add `dlqReason`/`retryCount` to `MarketplaceBulkPublishRun`/`RunItem` consistent with the existing `MarketplaceExportJob` pattern, or explicitly document why this run type doesn't need it.
3. **Native-path ceiling** — split the DTO's `@ArrayMaxSize` so the still-synchronous native (Amazon) path keeps its original (or a re-justified) lower bound independent of the async non-native ceiling.
4. **Unified plan-limit error contract** — route bulk-edit's SKU-limit failure through the same `PLAN_LIMIT_EXCEEDED`/402/`upgrade_url` shape (and make sure it actually reaches the HTTP layer, not just an internal job-item field) that catalog and marketplace already use.
5. **Feature flag** — gate `createBulkPublishRun`/the `MARKETPLACE_BULK_PUBLISH` consumer behind an env flag consistent with this codebase's existing pattern, so the async path can be disabled without a revert if any of the above surfaces in production before it's fully hardened.
6. **Regression test for the crash/redelivery path** — at minimum, one test that calls `processBulkPublishRun` twice against the same run (simulating a stalled-job redelivery) and asserts `excludedCount`/`succeededCount` don't double-count, and one that simulates a claim-then-crash and asserts the item is recoverable.

None of these require re-architecting the PR; all are bounded, targeted fixes to the same files this PR already touches.

Conditions 1, 2, 5, and 6 are intended to be CLOSED once [PR #723](https://github.com/bhoivishal216-ai/PIM/pull/723) merges (see Correction above — the original PR #719 merged before they landed on it). 3 and 4 remain open in #723 too and were explicitly accepted as deferred risk — see the decision log below.

---

## Decision Log

### 2026-09-05 — Original merge/deploy intent (superseded)

This entry recorded the plan at the time: fix conditions 1/2/5 on PR #719's branch, then merge and deploy. It is superseded by the entry below because **PR #719 merged (04:10:17Z) before the fix commits were pushed to its branch** — the approved scope below never actually executed as written; the unfixed version is what merged. Left here for the record rather than deleted.

| Field | Value |
| --- | --- |
| Decision (as drafted, not executed as intended) | CONDITIONAL PASS — merge and deploy to production, with conditions 3 and 4 explicitly deferred as accepted risk |
| Date | 2026-09-05 |
| Approvers | CTO (Vishal Bhoi), PO (Vishal Bhoi) — via explicit directive in session |
| Approved scope | Merge PR #719 to `main` with fixes applied |
| What actually happened | PR #719 merged separately (by the human approver, via the GitHub UI) before the fix commits reached its branch; `main` received the unfixed version |

### 2026-09-05 — PR #723 merged to main

| Field | Value |
| --- | --- |
| Decision | PR #723 merged to `main` (squash merge). Conditions 1, 2, 5, 6 CLOSED on `main`. Conditions 3, 4 remain open, accepted as deferred non-data-loss risk. **Merging to `main` is confirmed NOT equivalent to live production promotion in this repo — a separate, more formal promotion gate exists (named CTO/PO/Security/QA/SRE approvals + staging proof, per PR #722's own description) and has not been invoked for this work.** |
| Date | 2026-09-05T16:24:34Z (PR #723 merge) |
| Approvers | CTO/PO (Vishal Bhoi) — merged #723 directly via GitHub UI after CI went green (detect-changes, build, backend-tests, e2e all passed) |
| Environment | Fixes verified via unit tests only (87 tests: 74 marketplace + 7 queue + 6 env-validation, all passing on top of current `main`) plus `tsc` clean, plus full CI on #723 itself. No live staging or production environment touched. |
| Evidence references | This document; commits `373032f7`/`682a1306` (stuck-item reclaim + retry-aware DLQ marking), `0557d98b`/`cfc8a910` (kill switch); PR #723; merge commit `ecd68a6b` |
| Accepted risks | (3) Amazon/native bulk-publish requests up to 2000 products remain fully synchronous in-request and can still time out at scale — isolated to native connectors, not the async path this review was centered on. (4) A tenant hitting their SKU cap via bulk-edit still gets a generic failure with no upgrade CTA, instead of the `PLAN_LIMIT_EXCEEDED` shape used elsewhere — a support-cost/UX issue, not a data-loss or security risk. |
| Explicitly NOT done | Live/production promotion. `docs/runbooks/production-deploy.md`'s pre-deploy checklist (manual DB backup, team-channel deploy announcement, active-pilot-tenant-session check) has not been executed, and the separate named-approval promotion gate referenced by PR #722 has not been invoked. `main` having these fixes does not mean they are live for real users. |
| Next review | Before any live-promotion action: identify and follow the actual current promotion process (superseding the possibly-stale production-deploy runbook), and complete its approval/evidence requirements. |

### 2026-09-06 — PR #725 (conditions 3 & 4) merged to main

| Field | Value |
| --- | --- |
| Decision | Conditions 3 and 4 CLOSED on `main`. [PR #725](https://github.com/bhoivishal216-ai/PIM/pull/725) merged (squash, `5a66f06b`) after full CI passed (detect-changes, build, backend-tests, e2e). All 6 original CTO-review conditions from 2026-09-05 are now closed on `main`. |
| Date | 2026-09-05T23:59:08Z (PR #725 merge) |
| Approvers | CTO/PO (Vishal Bhoi) — merged directly via GitHub UI after CI went green |
| Environment | Unit tests only (95 tests: marketplace.service.spec.ts + bulk-edit.service.spec.ts) plus `apps/api` `tsc` and `apps/web` `tsc -p tsconfig.lint.json`, plus full CI on #725 itself. Merge content re-verified directly against `main`'s actual file text (`NATIVE_BULK_PUBLISH_CEILING`, `errorCode` in both bulk-edit.service.ts and schema.prisma) rather than commit-SHA ancestry. No live staging or production environment touched. |
| Evidence references | This document; commit `dbb1bebc` (native ceiling + unified plan-limit error contract); PR #725; merge commit `5a66f06b` |
| Note | An unrelated, pre-existing failure in `operations-bulk-edit-route-contract.test.cjs` was found on current `main` during this work (different file than the one this PR touches) — flagged as a separate follow-up task, not part of this PR's scope, still open. |
| Explicitly NOT done | Live/production promotion — same standing gap as noted in the PR #723 entry above. Closing these 6 conditions on `main` does not mean this feature is live for real pilot tenants. |
| Next review | Before any live-promotion action for the async bulk-publish feature: identify and follow the actual current promotion process, and complete its approval/evidence requirements. |

### 2026-09-06 — operator retry-failed endpoint (PR #731)

A separate, independently-written local implementation of async bulk-publish was found (in a stale, uncommitted checkout at `C:\Users\bhoiv\PIM1`, base commit predating PR #719 entirely) attempting to rebuild functionality that had already shipped via #719/#723/#725. Comparison against current `main` found it was 100% redundant except for one genuinely new, not-yet-covered idea: an operator-triggered retry for failed bulk-publish items — which happens to match a gap this review flagged directly ("nothing reads `retryEligible`... no bulk-publish-specific requeue endpoint exists").

That implementation wasn't portable (built against a diverged schema — a `retrying` item state and `run.failureReason` field that don't exist in the real schema), so it was reimplemented cleanly against current `main`: `POST /connectors/bulk-publish-runs/:runId/retry-failed`. 6 new regression tests; `marketplace.service.spec.ts` (83 tests), `apps/api` `tsc`, and `apps/api` build all pass.

**[PR #731](https://github.com/bhoivishal216-ai/PIM/pull/731) merged 2026-09-06T05:22:31Z (squash, `19023c24`)**, verified against `main`'s actual content. First CI attempt failed on the `build` job's `openapi:check` step — the committed `docs/openapi.yaml`/`.json`/Postman collection hadn't been regenerated for the new route; fixed by running `npm run openapi:generate` and committing the (purely additive) result. Full CI green on the second attempt.

The rest of that stale checkout's changes (schema, queue registration, controller/action wiring, status polling) were confirmed fully redundant with what's already on `main` and were left untouched, uncommitted, in that local checkout.

### 2026-09-06 — infrastructure finding: no separate production environment exists

While planning live verification, found via the Railway CLI that this project has **exactly one Railway environment ("Staging"), and it is bound to `app.vexapim.com`** — the domain real pilot tenants use. `railway environment production` returns "Environment not found." `deploy-staging.yml` auto-deploys on every push to `main`. **There is no infrastructure-level gate between merging to `main` and reaching real pilot customers** — the "live promotion" language in PR #722 and this document's earlier entries describes a process/policy discipline (evidence-gathering, named approvals), not a technical barrier. Every PR merged in this session (#723, #725, #730, #731, and the retry-failed UI below) auto-deployed to the real customer-facing environment within minutes of merging.

This corrects the standing "NOT confirmed live-promoted" caveat used throughout this document — the more accurate framing is: **these changes are live**, and the "production promotion" gate described in other project docs is a self-imposed governance process that was not followed here (this session treated `main` as a safe pre-production holding area, which the infrastructure does not actually provide).

### 2026-09-06 — Retry failed UI (PR #737)

PR #731 shipped the retry-failed endpoint with no UI to trigger it. Added a **Retry failed** button to the Jobs workspace's Bulk Publish Runs panel (shown only for terminal runs with failed items), reusing the existing submission-retry action's exact shape. `apps/web` `tsc` clean, no test regression. Live browser click-through was attempted but blocked by an unrelated issue: the shared local dev Postgres instance's migration history has diverged (missing the `MarketplaceBulkPublishRun` table entirely) — collateral damage from the stale-checkout Codex session's concurrent, unrelated activity against the same shared local DB, not caused by this change.

**[PR #737](https://github.com/bhoivishal216-ai/PIM/pull/737) merged 2026-09-06T15:33:32Z (squash, `2e9759b0`)**, verified against `main`'s actual content, full CI green (build, e2e; backend-tests correctly skipped for a web-only change). Per the infrastructure finding above, this is live to real pilot tenants now.
