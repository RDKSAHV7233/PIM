# Vexa PIM UI/UX Pilot-Readiness Execution Plan - 2026-04-30

Status: PO-validated execution plan  
Decision basis: accepted Vexa PIM product/CTO/UIUX review documentation  
Target posture: controlled pilot preparation, not broad release, not enterprise-ready  
Execution mode: preserve-first, regression-proof-driven, no silent rebuilds

## 1. PO Validation

Final PO position:

```text
Review documentation accepted.
Do not mark enterprise-ready.
Do not claim full role-readiness.
Move next to UI/UX pilot-readiness execution.
```

Approved product posture:

```text
Demo: yes
Controlled pilot: conditional
Broad release: no
Enterprise-ready: no
```

Main interpretation:

```text
Backend/access-policy maturity is stronger than frontend UX maturity.
```

Therefore, the next execution wave should focus on UI contract stabilization and pilot-readiness fixes, not another backend access-policy wave.

## 2. Guardrail Position

Repository guardrails require:

- Do not rebuild or rewrite completed work unless regression proof exists.
- Locked stories in `docs/execution/INCREMENT_STATE.json` cannot be edited without regression proof.
- Every implementation task must define explicit file scope.
- Do not update `INCREMENT_STATE.json` until acceptance passes and lock criteria are met.

Relevant locked/in-progress state from `docs/execution/INCREMENT_STATE.json`:

| Area | State | Execution meaning |
|---|---|---|
| `INC-01` UI stories | completed/locked | UI shell/product-detail/pending-feedback changes need regression proof. |
| `INC-08` release readiness | increment `in_progress`, stories locked | Pilot-readiness review can inspect and plan; closure needs separate release evidence. |
| `INC-09` connector metrics | story `ST-CON-METRICS-001` in progress/unlocked | Can be assessed for pilot impact without reopening locked connector mapping work. |
| `INC-10` Flipkart runtime/publish/status | stories in progress/unlocked | Can be assessed for connector/runtime pilot impact. |
| `INC-24` access-policy | completed/locked | Do not reopen unless access-policy regression appears. Current PO direction says not to start another backend access-policy wave. |

## 3. Regression Proof For Pilot Fix Scope

These are the currently accepted proofs that justify focused UI/pilot-readiness work:

| Priority | Regression or gap proof | Exact failing command / evidence | Likely file area | Classification |
|---|---|---|---|---|
| P1 | Missing canonical web test script | `npm run test --workspace @pim1/web` failed: `Missing script: "test"` | `apps/web/package.json`, web integration test runner | Release/pilot validation gap |
| P1 | Web UI contract suite not green | Direct loop over `apps/web/test/integration/*.test.cjs`: `total=77 failed=12` | `apps/web/test/integration/*`, shell/product/admin/connector pages | UI contract stabilization |
| P1 | Product dirty-state protection missing | Live staging smoke: product title edit followed by Variants tab navigation showed no warning, `unsavedWarningShown=false` | `apps/web/src/app/products/[id]/*`, product form components | Real UX/data-loss blocker |
| P2 | Variant lifecycle incomplete | Live staging: variant create worked, edit/delete controls not visible; source list renders no row actions | `apps/web/src/app/products/[id]/_components/variants-tab.tsx`, API variant routes/actions | Pilot workflow gap |
| P2 | Bulk import row-level verification incomplete | Live staging: upload submission observed, imported catalog rows not fully verified | `apps/web/src/app/operations/imports`, `apps/web/src/app/operations/jobs`, bulk-import APIs/tests | Pilot validation gap |
| P2 | Publish/export connector path not deeply tested | Review doc accepted publish/export as not deeply tested | product channels tab, connector/export job routes/tests | Pilot validation gap |
| P2 | Cross-role notifications not tested end to end | Review doc accepted notifications backend passed, but cross-role live workflow untested | notifications center, approvals/import/publish events | Pilot validation gap |

## 4. Execution Order

### Phase 1 - Test Entry And Contract Stabilization

Goal: Make UI regression validation repeatable before feature fixes.

Scope:

- `apps/web/package.json`
- `apps/web/test/integration/*.test.cjs`
- Optional new runner under `apps/web/test/` or `scripts/` if needed

Tasks:

1. Add a canonical `test` script for `@pim1/web`.
2. Decide whether the script runs all integration tests or a maintained pilot-readiness subset.
3. Triage the 12 failing UI contract tests into:
   - stale exact-string/path assertions
   - real product gaps
   - tests that should move to a separate release-hardening suite
4. Fix stale tests only when source evidence proves behavior already exists.
5. Do not weaken real product-gap tests.

Validation:

```text
npm run test --workspace @pim1/web
npm run lint --workspace @pim1/web
node apps/web/test/integration/dashboard-route-contract.test.cjs
git diff --check
```

Exit criteria:

- Canonical web test command exists.
- Failing contracts have documented disposition.
- Any green subset is explicitly named as pilot-readiness validation, not full UI regression closure.

### Phase 2 - Product Dirty-State Protection

Goal: Prevent silent loss of product edits during tab/navigation changes.

Scope:

- `apps/web/src/app/products/[id]/page.tsx`
- `apps/web/src/app/products/[id]/_components/content-tab.tsx`
- `apps/web/src/app/products/[id]/_components/product-detail-shared.tsx`
- Optional new client component under `apps/web/src/app/products/[id]/_components/`
- Relevant web integration tests

Tasks:

1. Add dirty-state tracking for product content/attribute edits.
2. Warn on product detail tab navigation when form is dirty.
3. Warn on browser back/refresh if dirty.
4. Clear dirty state after successful save.
5. Add regression coverage for dirty-state tab navigation.

Validation:

```text
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/web
node apps/web/test/integration/product-detail-route-contract.test.cjs
node apps/web/test/integration/product-detail-workflow-ui.test.cjs
new/updated dirty-state regression test
```

Exit criteria:

- Product edit tab navigation shows a warning or confirm path.
- Browser navigation has protection where technically supported.
- No regression to product save/validate actions.

### Phase 3 - Variant Lifecycle Verification Or Fix

Goal: Ensure pilot users can correct variant mistakes.

Scope:

- `apps/web/src/app/products/[id]/_components/variants-tab.tsx`
- `apps/web/src/app/actions.ts`
- API variant endpoints only if existing backend support is insufficient
- Variant lifecycle tests

Tasks:

1. Verify whether backend supports variant update/delete/archive.
2. If present, expose edit/delete/archive controls in the variant table.
3. If absent, document as pilot limitation or add scoped backend support only with PO approval.
4. Add confirmation for destructive actions.
5. Add test coverage for visible controls and role gating.

Validation:

```text
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/web
node apps/web/test/integration/product-detail-route-contract.test.cjs
variant lifecycle regression test
```

Exit criteria:

- Variant create/list remains working.
- Variant edit/delete/archive status is either proven and tested, or explicitly scoped out of pilot claims.

### Phase 4 - Bulk Import Row-Level Verification

Goal: Prove upload success maps to job result and catalog rows.

Scope:

- `apps/web/src/app/operations/imports/page.tsx`
- `apps/web/src/app/operations/jobs/page.tsx`
- `apps/web/src/app/operations/repair/page.tsx`
- Bulk import API integration tests if needed
- Live staging smoke script/runbook if present

Tasks:

1. Run a 3-row successful import and verify catalog reflection.
2. Run a partial failure import and verify row-level failure details.
3. Run duplicate SKU import and verify warning/error behavior.
4. Ensure UI exposes failed row details and retry/repair path.
5. Document exact pilot claim for bulk import.

Validation:

```text
node apps/web/test/integration/operations-imports-route-contract.test.cjs
node apps/web/test/integration/operations-jobs-route-contract.test.cjs
node apps/web/test/integration/operations-repair-route-contract.test.cjs
relevant bulk-import API integration tests
live staging TEST-* import evidence if credentials/environment are available
```

Exit criteria:

- Upload, process, row result, and catalog reflection are proven for bounded pilot data.
- Partial failure and duplicate behavior are documented.

### Phase 5 - Publish/Export And Notification Pilot Scenarios

Goal: Prove operator handoffs for pilot-safe scenarios.

Scope:

- `apps/web/src/app/products/[id]/_components/channels-tab.tsx`
- `apps/web/src/app/channels/*`
- `apps/web/src/components/nav/notification-center.tsx`
- Connector/export job tests and staging runbooks

Tasks:

1. Queue export for a TEST product on a safe connector path.
2. Verify job status and retry/requeue path.
3. Trigger publish failure if possible and verify error clarity.
4. Verify import completed/failed, approval requested/decision, and publish failed notifications.
5. Capture pilot evidence without storing secrets.

Validation:

```text
node apps/web/test/integration/channels-submissions-route-contract.test.cjs
node apps/web/test/integration/channels-health-route-contract.test.cjs
node apps/web/test/integration/notification-center-ui.test.cjs
node apps/api/test/integration/notifications-center.test.cjs
connector/export integration tests selected by pilot connector
```

Exit criteria:

- Publish/export is either proven for pilot scope or explicitly excluded from pilot claims.
- Cross-role notifications have at least one end-to-end proof path.

## 5. PO Validation Gates

Before pilot:

```text
[ ] Canonical web test command exists.
[ ] UI contract failures triaged and either fixed or formally waived.
[x] Product dirty-state protection works.
[x] Variant lifecycle status is proven or scoped out.
[x] Bulk import row-level results are proven.
[x] Publish/export pilot scope is proven or scoped out.
[x] Cross-role notification path is proven or scoped out.
[x] Frontend role-aware UX alignment has bounded role-by-role proof.
[x] INC-08 and connector/runtime in-progress items have pilot-impact notes.
```

Do not claim:

```text
enterprise-ready
broad release-ready
all role journeys complete
full UI regression suite green
complete connector/runtime readiness
bulk import fully verified beyond tested bounds
```

## 6. Recommended Immediate Next Task

Start with Phase 1 because it removes ambiguity from every later fix.

Proposed first implementation scope:

```text
apps/web/package.json
apps/web/test/integration/*.test.cjs
optional: apps/web/test/run-integration.cjs or scripts/run-web-integration-tests.cjs
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Regression proof:

```text
Exact failing command:
npm run test --workspace @pim1/web

Failing output snippet:
Missing script: "test"

Likely file path:
apps/web/package.json
```

PO acceptance condition for Phase 1:

```text
The web test command exists and either passes the maintained pilot suite or fails only on documented product gaps that remain in the pilot backlog.
```

## 7. Phase 1 Execution Record

Execution status: **completed**

Scope executed:

```text
apps/web/package.json
apps/web/test/integration/run-all.cjs
apps/web/test/integration/admin-plan-signup-conversion-ui.test.cjs
apps/web/test/integration/api-http-error-guard.test.cjs
apps/web/test/integration/auth-shell-ui.test.cjs
apps/web/test/integration/catalog-delete-ui.test.cjs
apps/web/test/integration/catalog-first-shell.test.cjs
apps/web/test/integration/connector-access-delete-helper.test.cjs
apps/web/test/integration/global-search-ui.test.cjs
apps/web/test/integration/internal-surface-gating.test.cjs
apps/web/test/integration/marketplace-capability-ui-gating.test.cjs
apps/web/test/integration/notification-center-ui.test.cjs
apps/web/test/integration/pending-feedback-rollout-ui.test.cjs
apps/web/test/integration/product-shell-uiux.test.cjs
apps/web/src/components/nav/authenticated-shell.tsx
```

Scope expansion:

- `apps/web/src/components/nav/authenticated-shell.tsx` was changed because `internal-surface-gating.test.cjs` proved a seller-facing navigation regression: internal/lab routes were visible for generic admin shell users. The fix hides internal nav from the shared authenticated shell while leaving the hard-gated internal routes in place.

What changed:

- Added canonical web test commands:
  - `npm run test --workspace @pim1/web`
  - `npm run test:integration --workspace @pim1/web`
- Added `apps/web/test/integration/run-all.cjs` to run all checked-in web integration tests with a repo-root working directory.
- Updated stale UI contract tests that still pointed at old file locations or pre-refactor shell ownership:
  - API helper assertions now read `apps/web/src/lib/api/core.ts`.
  - Global search, notification center, and role badge assertions now inspect `AuthenticatedShell`.
  - Marketplace publishability assertions now inspect the deferred product detail section and channels tab.
  - Plan commercial workflow assertion now matches Vexa commercial copy.
  - Delete/pending feedback assertions now match current source copy and dynamic install pending labels.
- Fixed the internal navigation product gap by setting `showInternal={false}` in the seller-facing authenticated shell.

Validation results:

| Command | Result | Notes |
|---|---|---|
| Previous failing 12-test subset | Pass | All 12 originally failing UI contracts now pass. |
| `npm run test --workspace @pim1/web` | Pass | 77 total, 77 passed, 0 failed. |
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` passed. |
| `npm run build --workspace @pim1/web` | Pass | Next.js build compiled successfully and generated 29 static pages. |

Remaining pilot blockers after Phase 1:

```text
1. Product dirty-state/unsaved-change protection still needs implementation.
2. Variant edit/delete lifecycle still needs verification or implementation.
3. Bulk import row-level verification still needs live or integration proof.
4. Publish/export connector pilot path still needs bounded proof.
5. Cross-role notification workflow still needs end-to-end validation.
6. INC-08 and connector/runtime in-progress items still need pilot-impact review.
```

Recommended next action:

```text
Proceed to Phase 2: product dirty-state protection.
```

## 8. Phase 2 Execution Record

Execution status: **completed**

Scope executed:

```text
apps/web/src/app/products/[id]/page.tsx
apps/web/src/app/products/[id]/_components/content-tab.tsx
apps/web/src/app/products/[id]/_components/product-dirty-navigation-guard.tsx
apps/web/test/integration/product-dirty-state-ui.test.cjs
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Scope expansion:

- None. The fix stayed inside product detail UI and web integration-test scope.

What changed:

- Mounted a product dirty-state guard on the product detail page.
- Marked product detail tab links and the Submit-to-channels link as guarded navigation.
- Marked the editable product content form with `data-product-dirty-form="true"`.
- Added a client-side confirmation dialog for dirty product edits:
  - `Stay on this tab` cancels navigation and preserves the in-progress edit state.
  - `Leave without saving` clears the dirty state and continues to the selected tab.
  - Clean forms navigate without warning.
- Added browser unload protection with `beforeunload` while product edits are dirty.
- Added `product-dirty-state-ui.test.cjs` to lock the form opt-in, guarded tab links, unload warning, and cancel/confirm paths.

Validation results:

| Command | Result | Notes |
|---|---|---|
| `node apps/web/test/integration/product-dirty-state-ui.test.cjs` | Pass | Proved product edit form opt-in, guarded tabs, unload warning, cancel path, and confirm path. |
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` passed after replacing unsupported `Button` variant `outline` with `secondary`. |
| `npm run build --workspace @pim1/web` | Pass | Sequential build passed; earlier parallel run failed from `.next` artifact contention, not product code. |
| `npm run test --workspace @pim1/web` | Pass | 78 total, 78 passed, 0 failed after rerun with sequential build/test execution. |
| `git diff --check` | Pass | CRLF warnings only; no whitespace errors. |
| Touched-file secret scan | Pass | Only benign documentation references to credentials/secrets; no credentials or secrets added. |

Failure handling:

```text
Failure 1:
Command: npm run lint --workspace @pim1/web
Snippet: Type '"outline"' is not assignable to type 'ButtonVariant | undefined'.
Likely file/area: apps/web/src/app/products/[id]/_components/product-dirty-navigation-guard.tsx
Classification: product compile regression introduced in current slice
Fix: replaced variant="outline" with supported variant="secondary"
Rerun: npm run lint --workspace @pim1/web passed

Failure 2:
Command: npm run test --workspace @pim1/web and npm run build --workspace @pim1/web run in parallel
Snippet: Could not find a production build in the '.next' directory / ENOENT .next server trace file
Likely file/area: generated apps/web/.next build output
Classification: environment/artifact race caused by concurrent Next.js build/start validation
Fix: stopped leftover validation Node processes, removed generated apps/web/.next after resolving path inside workspace, reran build/test sequentially
Rerun: npm run build --workspace @pim1/web passed; npm run test --workspace @pim1/web passed
```

Pilot-readiness claim after Phase 2:

```text
Product edit dirty-state protection is now code-backed and test-backed for product detail tab navigation and browser unload. This closes the accepted P1 smoke blocker for silent loss of product edits during product tab switching.
```

Remaining pilot blockers after Phase 2:

```text
1. Variant edit/delete lifecycle still needs verification or implementation.
2. Bulk import row-level verification still needs live or integration proof.
3. Publish/export connector pilot path still needs bounded proof.
4. Cross-role notification workflow still needs end-to-end validation.
5. Frontend role-aware UX alignment still needs role-by-role proof.
6. INC-08 and connector/runtime in-progress items still need pilot-impact review.
```

Recommended next action:

```text
Proceed to Phase 3: variant lifecycle verification or fix.
```

## 9. Phase 3 Execution Record

Execution status: **completed**

Scope executed:

```text
apps/web/src/app/actions.ts
apps/web/src/app/products/[id]/_components/variants-tab.tsx
apps/web/test/integration/product-variant-lifecycle-ui.test.cjs
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Scope expansion:

- `apps/web/src/app/actions.ts` was included because backend variant `PATCH` and `DELETE` contracts already exist, but the web UI had only `createVariantAction`. Adding web server actions was the smallest frontend-owned bridge to expose the existing backend lifecycle.

What changed:

- Added `updateVariantAction` using `PATCH /catalog/variants/:id`.
- Added `deleteVariantAction` using `DELETE /catalog/variants/:id`.
- Exposed inline variant row edit controls for writable roles:
  - SKU
  - attributes JSON
  - MRP
  - selling price
  - inventory quantity
  - lifecycle status
- Added row-level `Update variant` action.
- Added row-level `Remove variant` action inside a confirmation disclosure with a required confirmation checkbox.
- Preserved read-only behavior for roles without write access.
- Added `product-variant-lifecycle-ui.test.cjs` to prove:
  - backend update/delete contracts exist
  - web actions call the existing contracts
  - row edit controls are visible
  - deletion requires confirmation
  - lifecycle controls remain role-aware

Validation results:

| Command | Result | Notes |
|---|---|---|
| `node apps/web/test/integration/product-variant-lifecycle-ui.test.cjs` | Pass | Proved variant lifecycle UI and backend contract bridge. |
| `node apps/web/test/integration/product-detail-route-contract.test.cjs` | Pass | Product detail route contract remained green. |
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` passed. |
| `npm run test --workspace @pim1/web` | Pass | 79 total, 79 passed, 0 failed. |
| `npm run build --workspace @pim1/web` | Pass | Next.js build compiled and generated 29 static pages. |
| `git diff --check` | Pass | CRLF warnings only; no whitespace errors. |
| Touched-file secret scan | Pass | Full-file scan flagged pre-existing action names/credential fields in `actions.ts`; added-line diff scan found no newly introduced secrets or credentials. |

Failure handling:

```text
No slice-specific validation failures occurred in Phase 3.
```

Pilot-readiness claim after Phase 3:

```text
Variant lifecycle is now backend-backed and UI-backed for controlled pilot scope: writable users can create, edit, and remove variants, while destructive removal requires explicit confirmation and read-only users do not receive mutation controls.
```

Remaining pilot blockers after Phase 3:

```text
1. Bulk import row-level verification still needs live or integration proof.
2. Publish/export connector pilot path still needs bounded proof.
3. Cross-role notification workflow still needs end-to-end validation.
4. Frontend role-aware UX alignment still needs role-by-role proof.
5. INC-08 and connector/runtime in-progress items still need pilot-impact review.
```

Recommended next action:

```text
Proceed to Phase 4: bulk import row-level verification.
```

## 10. Phase 4 Execution Record

Execution status: **completed**

Scope executed:

```text
apps/web/src/app/operations/imports/page.tsx
apps/web/src/app/api/bulk-import/jobs/[jobId]/error-report/route.ts
apps/web/test/integration/bulk-import-row-verification-ui.test.cjs
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Scope expansion:

- Added a web API proxy route for bulk-import error-report CSV download because the backend route already exists, but the frontend needed an authenticated browser-safe download path.

What changed:

- The selected import job view now derives row-level results from `getBulkImportJobRows`.
- Added selected job result KPIs for processed, successful, failed, and dead-letter rows.
- Added a partial-failure callout when successful rows and failed/dead-letter rows coexist.
- Added an all-row result table showing:
  - row number
  - row status
  - catalog result
  - product link for successful rows with `productId`
  - no-product-created state for failed rows
  - translated error summary
  - retry count
- Kept the row repair console for non-success rows.
- Added an authenticated web proxy route for `GET /bulk-import/jobs/:id/error-report`.
- Added `bulk-import-row-verification-ui.test.cjs` to prove row-level result visibility, partial-failure UX, catalog reflection links, error-report download, failed-row repair visibility, and authenticated CSV proxy behavior.

Validation results:

| Command | Result | Notes |
|---|---|---|
| `node apps/web/test/integration/bulk-import-row-verification-ui.test.cjs` | Pass | Proved row-level result and error-report UX. |
| `node apps/web/test/integration/operations-imports-route-contract.test.cjs` | Pass | Existing imports route contract remained green. |
| `node apps/web/test/integration/operations-repair-route-contract.test.cjs` | Pass | Repair workspace contract remained green. |
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` passed. |
| `npm run test --workspace @pim1/web` | Pass | 80 total, 80 passed, 0 failed. |
| `npm run build --workspace @pim1/web` | Pass | Next.js build compiled and generated 29 static pages, including `/api/bulk-import/jobs/[jobId]/error-report`. |
| `git diff --check` | Pass | CRLF warnings only; no whitespace errors. |
| Added-line secret scan | Pass | No newly introduced secrets or credentials found in touched-file diff. |

Failure handling:

```text
No slice-specific validation failures occurred in Phase 4.
```

Pilot-readiness claim after Phase 4:

```text
Bulk import row-level verification is now UI-backed and test-backed for controlled pilot scope: upload/process jobs can be inspected through selected job results, successful rows link to created catalog products when available, failed rows remain repairable, partial failures are explicit, and error reports can be downloaded through an authenticated web route.
```

Remaining pilot blockers after Phase 4:

```text
1. Publish/export connector pilot path still needs bounded proof.
2. Cross-role notification workflow still needs end-to-end validation.
3. Frontend role-aware UX alignment still needs role-by-role proof.
4. INC-08 and connector/runtime in-progress items still need pilot-impact review.
```

Recommended next action:

```text
Proceed to Phase 5: publish/export connector pilot proof.
```

## 11. Phase 5 Execution Record

Execution status: **completed**

Scope executed:

```text
apps/web/test/integration/publish-export-pilot-proof-ui.test.cjs
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Scope expansion:

- None. This was a verification/documentation slice; no product code changes were needed.

What was proven:

- Product detail derives publishable channels only from active connector installations with `PUBLISH` capability.
- Product detail runs connector publish-readiness preflight with fallback acknowledgment unset by default.
- The product Channels tab shows:
  - readiness/preflight state
  - blockers and warnings
  - mapping and quality remediation links
  - bounded mapped payload preview
  - missing field diagnostics
  - risk score and export readiness
  - queued export action for writable roles
  - connector-missing fallback
  - read-only role fallback
  - queued export attempts table
  - status, retry count, failure reason, process, and requeue controls
- Web server actions are wired to existing queued export backend contracts:
  - create export job
  - process export job
  - requeue export job
- Product channel export UI does not expose connector secrets or credential fields.
- Channel submissions workspace preserves status, product drilldown, and submitted timestamp review for operator follow-up.

Validation results:

| Command | Result | Notes |
|---|---|---|
| `node apps/web/test/integration/publish-export-pilot-proof-ui.test.cjs` | Pass | Proved bounded queued-export pilot path. |
| `node apps/web/test/integration/channels-submissions-route-contract.test.cjs` | Pass | Existing submissions contract remained green. |
| `node apps/web/test/integration/marketplace-capability-ui-gating.test.cjs` | Pass | Publish action gating remained green. |
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` passed. |
| `npm run test --workspace @pim1/web` | Pass | 81 total, 81 passed, 0 failed. |
| `npm run build --workspace @pim1/web` | Pass | Next.js build compiled and generated 29 static pages. |
| `git diff --check` | Pass | CRLF warnings only; no whitespace errors. |
| Added-line secret scan | Pass | No newly introduced secrets or credentials found in touched-file diff. |

Failure handling:

```text
Initial verification test overclaimed that /channels/submissions contained selected channel-error review. Existing route evidence proves status/product/timestamp drilldown there, while failure details are on product queued export attempts and operations jobs. The test was narrowed to the proven behavior and rerun successfully.
```

Pilot-readiness claim after Phase 5:

```text
Publish/export is proven for controlled pilot as a bounded queued-export workflow: readiness/preflight, payload preview, role-gated queueing, job processing/requeue recovery, and submission follow-up are code-backed and test-backed. This does not prove full production marketplace runtime success or broad connector readiness.
```

Remaining pilot blockers after Phase 5:

```text
1. Cross-role notification workflow still needs end-to-end validation.
2. Frontend role-aware UX alignment still needs role-by-role proof.
3. INC-08 and connector/runtime in-progress items still need pilot-impact review.
```

Recommended next action:

```text
Proceed to Phase 6: cross-role notification workflow.
```

## 12. Phase 6 Execution Record

Execution status: **completed**

Scope executed:

```text
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Scope expansion:

- None. Existing backend and web tests already covered the required notification behavior; no application code changes were needed.

What was proven:

- Action generates notification:
  - bulk import failure creates `import_failed`
  - approval decision creates `approval_decision`
  - publish/export failure creates `publish_failed`
- Intended user/role receives notification:
  - import failure notifies triggering editor
  - approval decision notifies submitting editor
  - publish failure notifies export job creator
- Notification links to correct context:
  - import failure links to `/operations/imports?bulkJobId=...`
  - publish failure links to product detail `?tab=channels`
- Read/unread behavior works:
  - marking one notification read decrements unread count
  - web drawer optimistically marks read and supports mark-all-read
- Unauthorized/unintended visibility is constrained:
  - reviewer notification view filters to approval notifications
  - reviewer notification metadata is centrally redacted
- Web notification UX is mounted in authenticated shell, polls local route, uses CSRF on mutation routes, traps focus, restores focus, locks page scroll, and has empty/loading/read states.

Validation results:

| Command | Result | Notes |
|---|---|---|
| `node apps/api/test/integration/notifications-center.test.cjs` | Pass | Proved import failure, approval decision, publish failure, read/unread decrement, reviewer filtering, and reviewer metadata redaction. |
| `node apps/web/test/integration/notification-center-ui.test.cjs` | Pass | Proved notification center shell mount, polling, mark-all-read, drawer accessibility, optimistic unread updates, and CSRF route enforcement. |

Failure handling:

```text
No slice-specific validation failures occurred in Phase 6.
```

Pilot-readiness claim after Phase 6:

```text
Cross-role notifications are backend-backed and UI-backed for controlled pilot scope: key import, approval, and publish failure events create actionable notifications, links target the correct context, read/unread behavior is proven, and reviewer visibility is filtered/redacted.
```

Remaining pilot blockers after Phase 6:

```text
1. Frontend role-aware UX alignment still needs role-by-role proof.
2. INC-08 and connector/runtime in-progress items still need pilot-impact review.
```

Recommended next action:

```text
Proceed to Phase 7: role-aware frontend alignment.
```

## 13. Phase 7 Execution Record

Execution status: **completed**

Scope executed:

```text
apps/web/src/app/admin/users/page.tsx
apps/web/test/integration/role-aware-frontend-alignment-ui.test.cjs
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Scope expansion:

- None. The slice stayed inside admin role UX, web integration-test evidence, and execution documentation.

What changed:

- Added a `Pilot Role Alignment` card to `Users & Roles`.
- The card makes the controlled-pilot role model explicit:
  - product admin maps to current `Admin`
  - system admin maps to `Admin` plus internal operator routes outside the customer shell
  - editor maps to current `Editor`
  - reviewer maps to current `Reviewer`
  - vendor maps to read-only `Viewer` plus delegated scopes for now
  - category manager maps to `Editor` or `Reviewer` plus delegated category/brand scopes for now
  - API/client operations maps to admin-issued API keys with assigned roles
- The card explicitly states that dedicated vendor, category-manager, and system-admin shells remain future scope.
- Added `role-aware-frontend-alignment-ui.test.cjs` to prove the role model is bounded, visible, role-gated, and not overclaimed.

What was proven:

- Current first-class frontend roles are exactly `admin`, `editor`, `reviewer`, and `viewer`.
- Unsupported enterprise persona names (`product_admin`, `system_admin`, `category_manager`, `vendor`) are not silently accepted as `AppRole` values.
- Shared role capability helpers centralize edit, review-decision, and read-only behavior.
- Navigation visibility distinguishes all-role, editor-plus, and admin-only surfaces.
- The shared authenticated shell keeps internal/developer routes hidden from the customer shell.
- Admin Users exposes delegated category, brand, channel, and connector-account scopes.
- API/client operations are represented through admin-managed tenant-scoped API keys.
- Connector permission role choices remain aligned with the supported frontend roles.

Validation results:

| Command | Result | Notes |
|---|---|---|
| `node apps/web/test/integration/role-aware-frontend-alignment-ui.test.cjs` | Pass | Proved bounded role model, enterprise-persona mapping copy, delegated scopes, navigation gating, and API key handling. |
| `npm run test --workspace @pim1/web` | Pass | 82 total, 82 passed, 0 failed. |
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` passed. |
| `npm run build --workspace @pim1/web` | Pass | Next.js build compiled and generated 29 static pages. |
| `git diff --check` | Pass | CRLF warnings only; no whitespace errors. |
| Added-line secret scan | Pass | Benign product-copy matches for API keys/machine credentials only; no secrets or credentials added. |

Failure handling:

```text
No slice-specific validation failures occurred in Phase 7.
```

Pilot-readiness claim after Phase 7:

```text
Frontend role-aware UX is now bounded and documented for controlled pilot: admin, editor, reviewer, viewer, delegated scopes, and API-key machine-principal handling are code-backed and test-backed. Dedicated product_admin, system_admin, vendor, and category_manager shells remain future scope and must not be claimed as complete enterprise role UX.
```

Remaining pilot blockers after Phase 7:

```text
1. INC-08 and connector/runtime in-progress items still need pilot-impact review.
```

Recommended next action:

```text
Proceed to Phase 8: INC-08 and connector/runtime pilot-impact review.
```

## 14. Phase 8 Execution Record

Execution status: **completed**

Scope executed:

```text
docs/execution/INCREMENT_STATE.json
docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md
```

Scope expansion:

- None. This was a review/documentation-only slice. `INCREMENT_STATE.json` was inspected but not modified.

Evidence inspected:

- `docs/execution/INCREMENT_STATE.json`
- `INC-08` Release Readiness
- `INC-09` Connector Mapping Lifecycle + Publish Readiness
- `INC-10` Flipkart Publish Connector v1
- `INC-24` Access Policy Authorization Maturity
- Web connector honesty tests and route evidence from the preceding publish/export and role-aware slices

Pilot-impact classification:

| Area | Evidence | Classification | Pilot decision |
|---|---|---|---|
| `INC-08` Release Readiness | Increment status is `in_progress`; `pendingReleaseItems` include `RISK-P0-001 14-day broad rollout observation window pending` and `RISK-P0-001 production SLO trend evidence window pending`. | Broad release blocker, not controlled-pilot blocker. | Controlled pilot can proceed only with bounded pilot claim. Do not claim broad release or enterprise-ready until observation/SLO evidence closes. |
| `INC-09` `ST-CON-METRICS-001` | Story is `in_progress`, unlocked; acceptance concerns connector KPI trends for mapping completion, first publish success, setup time, and blocker resolution. | Enterprise observability gap / future-scope for pilot. | Does not block controlled pilot if KPI trend claims are excluded. Blocks mature enterprise observability claims. |
| `INC-10` increment summary | Increment shows `status=completed` and `deliveryStatus=completed`, but several runtime stories remain `in_progress` and unlocked. | Governance/status drift that blocks live connector-runtime completion claims. | Do not claim complete Flipkart runtime readiness until story statuses and evidence are reconciled. |
| `INC-10` `ST-FK-RUNTIME-003` | Story is `in_progress`, unlocked; acceptance covers encrypted credential runtime, refresh/token handling, OAuth callback, provider validation, and seller-readable provider errors. | Pilot blocker only for live Flipkart runtime pilot. | Not a blocker for queued-export pilot proof; blocks any claim that live Flipkart credential runtime is complete. |
| `INC-10` `ST-FK-PUBLISH-004` | Story is `in_progress`, unlocked; acceptance covers real token-authenticated provider publish and LIVE_API submission creation. | Pilot blocker only for live Flipkart publish. | Exclude live Flipkart publish from controlled pilot unless separately validated and locked. |
| `INC-10` `ST-FK-STATUS-005` | Story is `in_progress`, unlocked; acceptance covers manual provider-backed submission status sync. | Pilot blocker only for live Flipkart status sync. | Exclude provider-backed Flipkart status sync from controlled pilot unless separately validated and locked. |
| `INC-24` Access Policy Authorization Maturity | Increment status is `completed`, locked, with API build/access-policy/delegated-scope/sensitive-GET evidence listed. Acceptance also records that `category_manager` and `vendor` remain blocked until ownership/object-scope enforcement is proven. | Backend access-policy strength proven; enterprise persona UX remains bounded/future-scope. | Controlled pilot can use current four-role frontend plus delegated scopes. Do not claim full enterprise role model. |

Active pilot blockers after classification:

```text
None for a bounded controlled pilot limited to:
- core catalog/product workflows
- product dirty-state protection
- variant create/edit/delete lifecycle
- bulk import row-level review and repair
- queued export/readiness workflow
- cross-role notification paths
- current frontend roles: admin, editor, reviewer, viewer
```

Release and enterprise blockers that remain:

```text
1. INC-08 broad-rollout 14-day observation evidence is still pending.
2. INC-08 production SLO trend evidence is still pending.
3. INC-09 connector KPI trend story remains in progress/unlocked.
4. INC-10 has completed-increment vs in-progress-story status drift.
5. Live Flipkart credential runtime, provider publish, and provider status sync must not be claimed complete until the in-progress stories are formally closed or future-scoped.
6. Dedicated product_admin/system_admin/vendor/category_manager frontend shells remain future scope.
```

Controlled-pilot claim after Phase 8:

```text
Vexa PIM can be positioned for a bounded controlled pilot covering core catalog, product edit safety, variant lifecycle, bulk import row-level review, queued export readiness, notifications, and four-role frontend UX. The pilot must explicitly exclude broad release readiness, enterprise-ready claims, full connector KPI observability, dedicated enterprise persona shells, and complete live Flipkart runtime readiness.
```

Recommended next action:

```text
Run the final validation stack and produce the execution report.
```

## 15. Final Validation Record

Execution status: **completed**

Final validation results:

| Command | Result | Notes |
|---|---|---|
| `npm run test --workspace @pim1/web` | Pass | 82 total, 82 passed, 0 failed. |
| `npm run lint --workspace @pim1/web` | Pass | `tsc --noEmit` passed. |
| `npm run build --workspace @pim1/web` | Pass | Next.js production build compiled and generated 29 static pages. |
| `npm run build --workspace @pim1/api` | Pass after dependency repair | Standalone build passed before gate run, then failed after local dependency install drift, then passed after dependency repair. |
| `npm run test:integration:access-policy-remediation` | Pass | Access-policy remediation suite passed. |
| `npm run test:integration:delegated-access-scopes` | Pass | Delegated access scopes suite passed. |
| `npm run guard:sensitive-gets` | Pass | 71 authenticated-read routes, 158 authenticated routes, 19 public routes, 49 admin-boundary checked routes. |
| `node apps/api/test/integration/access-policy-foundation.test.cjs` | Pass | Foundation role, admin-boundary, sensitive-read, and API-client scope tests passed. |
| `node apps/api/test/integration/notifications-center.test.cjs` | Pass | Import failure, approval decision, publish failure, read/unread, reviewer filtering, and redaction tests passed. |
| `npm run gate:run:increment` | Pass on long rerun | First run exposed local dependency corruption and then timed out; long rerun passed 16/16 core gate steps. |
| `npm run gate:run:sprint` | Pass | Sprint gate passed 14/14 core gate steps. |
| `node scripts/validate-deploy-staging-workflow.cjs` | Pass | Staging workflow structure and artifact proof steps validated. |
| `node scripts/staging-postdeploy-check.test.cjs` | Pass | Workspace login, bearer reuse, logout/revocation, role render, non-admin denial, and stale token rejection validated. |
| `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"` | Pass | Increment state JSON is valid. |
| `git diff --check` | Pass | CRLF warnings only; no whitespace errors. |
| Touched-file secret scan | Pass | No secret-like assignments in added lines or new files for touched pilot-readiness files. |
| `git status --short` | Pass with dirty tree disclosure | Worktree remains dirty with this slice plus pre-existing/unrelated changes; no unrelated files were reverted. |

Failure handling:

```text
Failure:
Command: npm run gate:run:increment
Snippet: Error: Cannot find module './scheduleAsyncIterable' under node_modules/@angular-devkit/schematics/node_modules/rxjs; direct rerun then reported 'nest' is not recognized.
Likely file/area: local node_modules dependency installation, not application source.
Classification: environment/dependency artifact issue.
Fix: npm install --package-lock=false --ignore-scripts to repair local dependency installation only.
Rerun: npm run build --workspace @pim1/api passed; npm run gate:run:increment passed on long rerun.

Timeout:
Command: npm run gate:run:increment with a 5-minute tool timeout
Snippet: tool timeout with child gate processes still running.
Classification: inconclusive timeout, not a product failure.
Fix: waited for child processes to finish, then reran with a longer timeout.
Rerun: npm run gate:run:increment passed.
```

Final bounded pilot claim:

```text
Vexa PIM is ready for controlled pilot preparation for the proven bounded scope: catalog/product workbench, dirty-state-protected product editing, variant lifecycle, bulk import row-level review, queued export readiness, notifications, and current admin/editor/reviewer/viewer frontend roles. It is not broad-release-ready or enterprise-ready, and it must not claim complete live connector/runtime readiness, dedicated enterprise persona shells, or closed INC-08 broad-rollout/SLO evidence.
```

INCREMENT_STATE update:

```text
No `INCREMENT_STATE.json` lock update was made. The work completed pilot-readiness execution documentation and frontend slices, but no increment/story was formally closed in this task.
```
