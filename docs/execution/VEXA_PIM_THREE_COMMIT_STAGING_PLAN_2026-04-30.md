---
title: Vexa PIM Three-Commit Staging Plan
status: proposed
owner: Product + CTO
last_updated: 2026-04-30
---

## 1. Purpose

Capture the release-manager staging plan for the current validated dirty tree without deleting, cleaning, resetting, or removing any dirty or untracked file.

Safety rule for this plan:

- do not delete, discard, clean, reset, or remove any dirty/untracked file
- do not run `git clean`
- do not run `git reset`
- do not delete `.codex-evidence` or local artifacts
- only classify files into keep / quarantine / exclude-from-commit
- if files need physical separation later, move them only if explicitly requested

## 2. Current Validation Truth

Current rerun status:

- `npm run lint --workspace @pim1/api` -> pass
- `npm run build --workspace @pim1/api` -> pass
- `npm run lint --workspace @pim1/web` -> pass
- `npm run build --workspace @pim1/web` -> pass
- `npm run gate:run:increment` -> pass
- `npm run gate:run:sprint` -> pass
- `npm audit --omit=dev --audit-level=high` -> pass
- `git diff --check` -> pass

Release-manager interpretation:

- validation truthfulness is restored
- dependency P0 closure is acceptable again
- main remaining risk is commit hygiene and stale/mixed-scope docs

## 3. Commit 1: Dependency P0 / Express Migration / Audit Closure

Intent:

- commit the validated dependency-closure and API runtime migration slice as one coherent change

Recommended staged files:

- `apps/api/package.json`
- `package-lock.json`
- `apps/api/src/main.ts`
- `apps/api/src/api-keys/api-keys.controller.ts`
- `apps/api/src/audit/audit.controller.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/jwt-auth.guard.ts`
- `apps/api/src/auth/step-up.guard.ts`
- `apps/api/src/auto-suggestions/auto-suggestions.controller.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/billing/plan-guard.guard.ts`
- `apps/api/src/bulk-import/bulk-import.controller.ts`
- `apps/api/src/bulk-import/bulk-import.service.ts`
- `apps/api/src/bulk-import/dto/create-bulk-import-job.dto.ts`
- `apps/api/src/bulk-import/dto/create-bulk-import-template.dto.ts`
- `apps/api/src/catalog/catalog.controller.ts`
- `apps/api/src/catalog/products.controller.ts`
- `apps/api/src/common/audit/audit-log.interceptor.ts`
- `apps/api/src/common/rbac/rbac.guard.ts`
- `apps/api/src/common/security/internal-token.ts`
- `apps/api/src/compliance/compliance.controller.ts`
- `apps/api/src/compliance/issues.controller.ts`
- `apps/api/src/connector-framework/connector-framework.module.ts`
- `apps/api/src/connector-framework/connector-webhook-relay.controller.ts`
- `apps/api/src/connector-installer/connector-installer.controller.ts`
- `apps/api/src/dashboard/dashboard.controller.ts`
- `apps/api/src/media/media.controller.ts`
- `apps/api/src/notifications/notifications.controller.ts`
- `apps/api/src/outbound-webhooks/outbound-webhooks.controller.ts`
- `apps/api/src/platform-admin/platform-admin.controller.ts`
- `apps/api/src/platform-admin/platform-admin.module.ts`
- `apps/api/src/rejection-intelligence/rejection-intelligence.controller.ts`
- `apps/api/src/signup/signup.controller.ts`
- `apps/api/src/taxonomy/taxonomy.controller.ts`
- `apps/api/src/workspace-users/workspace-access-scopes.controller.ts`
- `apps/api/src/workspace-users/workspace-users.controller.ts`
- `apps/api/test/integration/bulk-import-spreadsheet-disabled.test.cjs`
- `apps/api/test/integration/internal-token-hardening-static.test.cjs`
- `apps/api/test/integration/workspace-user-crud.test.cjs`
- `docs/security/dependency-risk-register.md`
- `docs/execution/VEXA_PIM_DEPENDENCY_RISK_REGISTER_2026-04-30.md`

Selective staging note:

- `docs/execution/INCREMENT_STATE.json` belongs with this commit only for the `INC-25 / ST-DEP-P0-001` hunk(s) if selective staging is practical.
- If selective staging is not practical or would mix unrelated access-policy state, leave `INCREMENT_STATE.json` out and quarantine it for a dedicated follow-up state/doc commit.

## 4. Commit 2: Web UI/UX Pilot-Readiness and Web Test Runner

Intent:

- commit the proven web pilot-readiness slice and the canonical packaged web suite entrypoint

Recommended staged files:

- `apps/web/package.json`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/admin/users/page.tsx`
- `apps/web/src/app/api/auth/login/route.ts`
- `apps/web/src/app/api/bulk-import/jobs/[jobId]/error-report/route.ts`
- `apps/web/src/app/operations/imports/page.tsx`
- `apps/web/src/app/products/[id]/page.tsx`
- `apps/web/src/app/products/[id]/_components/content-tab.tsx`
- `apps/web/src/app/products/[id]/_components/product-dirty-navigation-guard.tsx`
- `apps/web/src/app/products/[id]/_components/variants-tab.tsx`
- `apps/web/src/components/nav/authenticated-shell.tsx`
- `apps/web/src/lib/api/core.ts`
- `apps/web/test/integration/admin-plan-signup-conversion-ui.test.cjs`
- `apps/web/test/integration/api-http-error-guard.test.cjs`
- `apps/web/test/integration/auth-cookie-csrf.test.cjs`
- `apps/web/test/integration/auth-shell-ui.test.cjs`
- `apps/web/test/integration/bulk-import-row-verification-ui.test.cjs`
- `apps/web/test/integration/catalog-delete-ui.test.cjs`
- `apps/web/test/integration/catalog-first-shell.test.cjs`
- `apps/web/test/integration/connector-access-delete-helper.test.cjs`
- `apps/web/test/integration/global-search-ui.test.cjs`
- `apps/web/test/integration/internal-surface-gating.test.cjs`
- `apps/web/test/integration/marketplace-capability-ui-gating.test.cjs`
- `apps/web/test/integration/notification-center-ui.test.cjs`
- `apps/web/test/integration/pending-feedback-rollout-ui.test.cjs`
- `apps/web/test/integration/product-dirty-state-ui.test.cjs`
- `apps/web/test/integration/product-shell-uiux.test.cjs`
- `apps/web/test/integration/product-variant-lifecycle-ui.test.cjs`
- `apps/web/test/integration/publish-export-pilot-proof-ui.test.cjs`
- `apps/web/test/integration/role-aware-frontend-alignment-ui.test.cjs`
- `apps/web/test/integration/run-all.cjs`
- `docs/execution/VEXA_PIM_UIUX_PILOT_READINESS_EXECUTION_PLAN_2026-04-30.md`

## 5. Commit 3: Documentation Closeout Refresh

Intent:

- commit the refreshed product/release documentation that now matches the latest green rerun and triage

Recommended staged files:

- `docs/execution/VEXA_PIM_CONTROLLED_PILOT_CLOSEOUT_2026-04-30.md`
- `docs/execution/VEXA_PIM_PRODUCT_CTO_UIUX_REVIEW_2026-04-30.md`
- `docs/execution/VEXA_PIM_THREE_COMMIT_STAGING_PLAN_2026-04-30.md`

Optional staged file if desired and scoped carefully:

- `docs/execution/INCREMENT_STATE.json` only if the staged hunks are limited to the intended truth-bearing increment updates and do not mix unrelated backlog history

## 6. Quarantine

Files that may be valid but should stay out of the three planned commits until separately reviewed:

- `docs/execution/ACCESS_POLICY_EXECUTION_RECORD_2026-04-26.md`
- `docs/execution/ACCESS_POLICY_PENDING_BACKLOG_PO_PROMPT_2026-04-27.md`
- `docs/execution/ACCESS_POLICY_PO_CHECKPOINT_2026-04-26.md`
- `docs/execution/INCREMENT_STATE.json` if selective staging cannot isolate the intended increment/state hunks cleanly
- `package.json` if its modified status remains line-ending or metadata noise without a substantive diff

Reliability quarantine note:

- Keep the `metrics-kpi-trends` retry behavior in mind as a release note / follow-up item until first-pass stability is proven consistently.

## 7. Exclude From Commit

Leave these untouched locally, but do not include them in product commits:

- `.codex-evidence/**`
- local screenshots
- raw staging capture JSONs
- temporary logs
- other local-only evidence artifacts

## 8. Fix-Now

No trivial hygiene fix is required right now.

- `git diff --check` is currently clean aside from CRLF warnings.

## 9. Final Staging Guidance

Recommended sequencing:

1. Stage and verify **Commit 1** in isolation.
2. Stage and verify **Commit 2** in isolation.
3. Stage and verify **Commit 3** in isolation.
4. Keep quarantined files untouched until separately reviewed.
5. Keep excluded local artifacts present on disk but out of all intended commits.

This plan does not delete, clean, reset, or remove any dirty or untracked file.
