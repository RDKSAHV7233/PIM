## Summary

This PR finalizes the current sellability slice for Vexa PIM without broadening scope into enterprise roadmap work.

It closes the product-facing gaps that were still blocking a clean controlled-pilot / early SMB-midmarket release story:

- revision-backed approval evidence
- validate-before-import preflight and staged import workflow
- responsive and accessibility hardening on remaining high-risk operator surfaces
- route loading/error coverage and more consistent operator-state handling
- golden-path browser proof for demo tenant and publish recovery
- user-guide and sales-claim alignment to the actual shipped product
- branding normalization to `Vexa`

Enterprise capabilities such as SSO/OIDC, SCIM, dedicated enterprise role shells, WooCommerce, full marketplace coverage, and self-serve billing remain explicitly out of scope.

## Scope

### Backend

- add `GET /catalog/products/:id/revisions`
- add `POST /bulk-import/validate`
- reuse existing audit/import parsing and validation systems
- add backend integration coverage for both contracts

### Frontend

- upgrade approvals from queue-only review to evidence-based review with a shared drawer
- upgrade imports into a strict staged operator workflow
- harden responsive and accessibility behavior on the remaining high-risk operational surfaces
- expand route-level loading/error coverage across core workflows
- reuse the current canonical primitives:
  - `DataGrid`
  - `AppDialog`
  - `AppDrawer`
  - `InlineAlert`
  - `WorkflowStepper`
  - `Timeline`
  - `Skeleton`
  - `PageHeader`

### Documentation

- refresh user-guide traceability and sellability wording
- normalize legacy `TEJ` branding to `Vexa`
- keep enterprise readiness explicitly out of claim scope

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

Environment-limited:

- `npx playwright test apps/web/test/e2e/viewport-core-workflows.spec.js --config playwright.config.cjs`
- `npx playwright test apps/web/test/e2e/keyboard-core-journey.spec.js --config playwright.config.cjs`
- `npm run gate:run:sprint`

Details and failure classification:

- See [`docs/execution/VEXA_PIM_VALIDATION_CAVEATS_2026-05-06.md`](docs/execution/VEXA_PIM_VALIDATION_CAVEATS_2026-05-06.md)

## Commercial Claim Boundary

Safe claim:

`Vexa PIM is sellable for controlled paid pilot / early SMB-midmarket customers with proven catalog, import, approval, connector, publish, audit, account-security, and recovery workflows. Enterprise readiness remains future-scope.`

Do not claim:

- enterprise-ready
- universal production-ready for all customer segments
- self-serve billing
- enterprise IAM / OIDC / SSO readiness
- connector breadth not explicitly proven in current UI/tests

## Reviewer Focus

1. Approval evidence workflow:
   - reviewer can inspect changed fields, before/after values, actor/time, and decision note without leaving the queue
2. Import workflow:
   - validate-before-import, blocking vs warning behavior, and repair/result handoff remain clear
3. Sellability guardrails:
   - connector honesty
   - bounded commercial wording
   - no enterprise overclaim in docs

## Changelog

changelog: [Added] Add revision-backed approval evidence and validate-before-import workflow for core operator review and import flows
changelog: [Changed] Harden responsive, accessibility, loading, and recovery states across sellability-critical product surfaces
changelog: [Docs] Refresh user-guide sellability claims and normalize product branding to Vexa
