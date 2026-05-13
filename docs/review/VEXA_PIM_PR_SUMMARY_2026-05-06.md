---
title: Vexa PIM sellable-product finalization PR summary
type: pr-summary
date: 2026-05-06
owner: Engineering
---

## Summary

This change finalizes the current sellability slice for Vexa PIM without broadening scope into enterprise roadmap work.

The branch closes the product-facing gaps that were still blocking a clean controlled-pilot / early SMB-midmarket release story:

- revision-backed approval evidence
- validate-before-import preflight and staged import workflow
- responsive and accessibility hardening on remaining high-risk operator surfaces
- route loading/error coverage and consistent operator-state handling
- golden-path browser proof for demo tenant and publish recovery
- user-guide and sales-claim alignment to the actual shipped product
- branding normalization to `Vexa`

## Scope

### Backend

- Add `GET /catalog/products/:id/revisions`
- Add `POST /bulk-import/validate`
- Reuse existing audit/import parsing and validation systems
- Add backend integration coverage for both contracts

### Frontend

- Upgrade approvals from queue-only review to evidence-based review with a shared drawer
- Upgrade imports into a strict staged operator workflow
- Harden responsive and accessibility behavior on the remaining high-risk operational surfaces
- Expand route-level loading/error coverage across core workflows
- Reuse the current canonical primitives:
  - `DataGrid`
  - `AppDialog`
  - `AppDrawer`
  - `InlineAlert`
  - `WorkflowStepper`
  - `Timeline`
  - `Skeleton`
  - `PageHeader`

### Documentation

- Refresh user-guide traceability and sellability wording
- Normalize legacy `TEJ` branding to `Vexa`
- Keep enterprise readiness explicitly out of claim scope

## Validation

Passing:

- `npm run prisma:generate`
- `npm run lint --workspace @pim1/api`
- `npm run build --workspace @pim1/api`
- `npm run lint --workspace @pim1/web`
- `npm run build --workspace @pim1/web`
- `npm run test --workspace @pim1/web`
- `npx playwright test apps/web/test/e2e/demo-tenant-end-to-end.spec.js --config playwright.config.cjs`
- `npx playwright test apps/web/test/e2e/publish-failure-recovery.spec.js --config playwright.config.cjs`
- `npm run guard:sensitive-gets`
- `npm run gate:run:increment`

Environment-blocked or harness-limited:

- `npx playwright test apps/web/test/e2e/viewport-core-workflows.spec.js --config playwright.config.cjs`
- `npx playwright test apps/web/test/e2e/keyboard-core-journey.spec.js --config playwright.config.cjs`
- `npm run gate:run:sprint`

Reason:

- local Playwright webServer and API startup contention
- intermittent local `dist` startup instability
- Windows filesystem cleanup instability under `apps/api/dist`

These did not surface a confirmed product regression in the touched workflows.

## Commercial Claim Boundary

Safe claim:

`Vexa PIM is sellable for controlled paid pilot / early SMB-midmarket customers with proven catalog, import, approval, connector, publish, audit, account-security, and recovery workflows. Enterprise readiness remains future-scope.`

Avoid claiming:

- enterprise-ready
- universal production-ready for all customer segments
- self-serve billing
- full MFA / OIDC enforcement
- connector breadth not explicitly proven in current UI/tests

## Changelog Lines

changelog: [Added] Add revision-backed approval evidence and validate-before-import workflow for core operator review and import flows
changelog: [Changed] Harden responsive, accessibility, loading, and recovery states across sellability-critical product surfaces
changelog: [Docs] Refresh user-guide sellability claims and normalize product branding to Vexa
