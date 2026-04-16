# Vexa PIM Product Test Strategy

Status: Current-state product test architecture for TEJ PIM  
Last updated: 2026-03-11

## Purpose

TEJ PIM already has many integration tests, but they were accumulated by technical slice. The product now needs a stable, product-facing test surface that answers a different question:

- can a seller log in and operate the shell?
- can catalog teams author and fix products?
- can channel teams complete publish readiness?
- can ops teams monitor failures and notifications?
- can admins govern access and tenancy safely?

This strategy keeps the existing tests and reorganizes them around product capabilities instead of subsystem ownership.

## Product Suite Entry Points

- `npm run test:product`
- `npm run test:product:shell`
- `npm run test:product:catalog`
- `npm run test:product:publish`
- `npm run test:product:operations`
- `npm run test:product:governance`
- `npm run test:product:uiux`

Runner:
- `scripts/run-product-suite.cjs`

The runner always starts with:
- API lint
- API build
- Web lint
- Web build

That keeps the suite anchored to a buildable current-state product before feature assertions run.

## Product Capability Matrix

### 1. Shell and Navigation

Goal:
- authenticated shell is usable
- topbar navigation is present
- sidebar reflects current TEJ PIM information architecture

Coverage:
- `apps/web/test/integration/auth-shell-ui.test.cjs`
- `apps/web/test/integration/product-shell-uiux.test.cjs`
- `apps/web/test/integration/global-search-ui.test.cjs`
- `apps/web/test/integration/notification-center-ui.test.cjs`
- `apps/web/test/integration/catalog-categories-hydration.test.cjs`

### 2. Catalog Authoring

Goal:
- teams can enter catalog work, create products, and move through the product workflow safely

Coverage:
- `apps/web/test/integration/catalog-first-shell.test.cjs`
- `apps/web/test/integration/product-workbench-ui.test.cjs`
- `apps/web/test/integration/product-detail-workflow-ui.test.cjs`
- `apps/api/test/integration/create-product-pricing-normalization.test.cjs`
- `apps/api/test/integration/product-workflow-transitions.test.cjs`

### 3. Publish Readiness and Channel Operations

Goal:
- mappings, readiness, and submissions work as one product capability

Coverage:
- `apps/web/test/integration/mapping-canonical-ui.test.cjs`
- `apps/web/test/integration/mapping-structured-editor.test.cjs`
- `apps/web/test/integration/mapping-editor-component.test.cjs`
- `apps/web/test/integration/taxonomy-search-component.test.cjs`
- `apps/web/test/integration/version-manager-component.test.cjs`
- `apps/web/test/integration/mapping-step-up-ui.test.cjs`
- `apps/web/test/integration/mapping-workflow-ui.test.cjs`
- `apps/api/test/integration/connector-mapping-lifecycle.test.cjs`
- `apps/api/test/integration/marketplace-readiness-batch.test.cjs`
- `apps/api/test/integration/submission-lifecycle-api.test.cjs`

### 4. Operations and Observability

Goal:
- operations can detect failures, see notifications, and monitor system health surfaces

Coverage:
- `apps/web/test/integration/ops-cockpit-ui.test.cjs`
- `apps/web/test/integration/notification-center-ui.test.cjs`
- `apps/api/test/integration/dashboard-aggregations.test.cjs`
- `apps/api/test/integration/notifications-center.test.cjs`
- `apps/api/test/integration/metrics-kpi-trends.test.cjs`
- `apps/api/test/integration/marketplace-worker-failure-visibility.test.cjs`

### 5. Governance and Access

Goal:
- permissions, reviewer workflow, auth boundaries, and tenant isolation remain intact

Coverage:
- `apps/web/test/integration/connector-access-admin-form.test.cjs`
- `apps/web/test/integration/quality-reviewer-role-ui.test.cjs`
- `apps/api/test/integration/connector-access-entitlements.test.cjs`
- `apps/api/test/integration/audit-actor-context.test.cjs`
- `apps/api/test/integration/auth-login-lockout.test.cjs`
- `apps/api/test/integration/quality-reviewer-role.test.cjs`
- `apps/api/test/integration/rls-isolation.test.cjs`

## UI/UX Validation Model

TEJ PIM does not currently use a browser-driven visual regression stack in this suite. Current UI/UX regression protection is a combination of:

- source-structure assertions on shipped page/component files
- build validation
- route/runtime smoke checks when a regression requires it

That is intentional for the current repo state. It keeps UI/UX validation stable on local Windows development without introducing a new browser automation dependency during every increment.

## Design Rules For New Tests

1. Add tests by product capability first, subsystem second.
2. Prefer asserting current user-facing behavior over implementation trivia.
3. If a test targets UI/UX, anchor it to shipped information architecture, task flow, or visible affordances.
4. Do not rewrite existing working tests unless a regression proves they are stale.
5. New product features should plug into one product suite and, if relevant, one UI/UX sub-suite.

## Current Open Gaps

Still open product work outside this test redesign:
- explorable audit log UI

When new product surfaces ship, update this matrix and the relevant `test:product:*` suite instead of creating disconnected test commands.
