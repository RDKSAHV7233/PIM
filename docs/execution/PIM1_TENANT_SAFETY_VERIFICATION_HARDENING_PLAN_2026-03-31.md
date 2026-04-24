---
title: PIM1 Tenant Safety + Verification Hardening Plan
status: proposed
owner: CTO + Backend Lead + QA Lead + DevOps + Web Lead
last_updated: 2026-03-31
baseline_audit: PIM1 current-state verification on refreshed HEAD `8911dc5`
---

## 1. Purpose

Define the next release slice for PIM1.

This plan is intentionally narrow. It does not try to add net-new product scope. It closes the launch blockers verified in:

- `PIM1_CURRENT_STATE_VERIFICATION.md`
- `PIM1_LAUNCH_BLOCKERS.md`
- `PIM1_TEST_COVERAGE_MATRIX.md`
- `PIM1_DOCS_VS_CODE_TRUTH.md`

The target outcome is:

- move from `NOT READY`
- to a cleaner `internal-ready / design-partner-ready` baseline
- with tenant safety and verification confidence materially improved

## 2. Current validated baseline

### Positive reality already proven

1. API build health is currently green on HEAD `8911dc5`.
2. Mapping lifecycle, precedence, rollback, step-up, and server-side readiness gating are real and verified.
3. Dashboard, auth, privacy, audit, issue inbox, approval queue, and submission monitoring are materially implemented.

### Current blockers that must be closed first

| Blocker | Severity | Evidence |
|---|---|---|
| `Variant.skuCode` is globally unique | Critical | `packages/db/prisma/schema.prisma:180`, `packages/db/prisma/schema.prisma:185` |
| `Category.slug` is globally unique | Critical | `packages/db/prisma/schema.prisma:104`, `packages/db/prisma/schema.prisma:108` |
| Manual-tenant-filter raw SQL remains in critical services | High | `apps/api/src/audit/audit.service.ts:81`, `apps/api/src/billing/plan-usage.service.ts:589`, `apps/api/src/compliance/compliance.service.ts:173`, `apps/api/src/dashboard/dashboard.service.ts:338`, `apps/api/src/marketplace/marketplace.service.ts:423`, `apps/api/src/media/media.service.ts:272` |
| Root verification still fails on connector idempotency semantics | High | `package.json:13`, `apps/api/test/integration/connector-idempotency-semantics.test.cjs` |
| Additional critical suites still fail login/workspace bootstrap | High | `apps/api/test/integration/marketplace-capability-gating.test.cjs`, `apps/api/test/integration/bulk-edit-empty-scope.test.cjs`, `apps/api/test/integration/media-ssrf-guard.test.cjs` |
| Standalone integration runs are environment-noisy | Medium | `apps/api/test/integration/env-validation.test.cjs`, `apps/api/test/integration/catalog-completeness.test.cjs`, `apps/api/test/integration/mapping-manager.test.cjs`, `apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`, `scripts/run-product-suite.cjs` |
| Launch-facing routes are still incomplete | Medium | `apps/web/src/app/admin/workspace/page.tsx:23`, `apps/web/src/app/settings/page.tsx:6`, `apps/web/src/app/settings/plan/page.tsx:6`, `apps/web/src/app/settings/privacy/page.tsx:6`, `apps/web/src/app/settings/connectors/page.tsx:6`, `apps/web/src/app/reports/page.tsx:6` |
| Connector scope is still uneven | Medium | `apps/api/src/connector-framework/connector-launch-policy.ts:19`, `apps/api/src/connector-framework/connector-launch-policy.ts:28`, `apps/api/src/connector-framework/connector-launch-policy.ts:52` |
| Rollout evidence is still open | Medium | `docs/execution/CURRENT_STATE.md:68`, `docs/execution/CURRENT_STATE.md:87`, `docs/execution/INCREMENT_STATE.json:498`, `docs/execution/INCREMENT_STATE.json:500` |

## 3. Release objective and non-negotiable exit gates

### Objective

Ship one focused hardening release that closes the tenant-safety blockers and restores a trustworthy verification baseline without expanding channel or UI scope.

### Non-negotiable exit gates

Do not move PIM1 to controlled beta until all of the following are true:

1. `Variant.skuCode` uniqueness is tenant-scoped.
2. `Category.slug` uniqueness is tenant-scoped.
3. Critical `RLS-BYPASS` paths are either removed or explicitly approved with automated tenant-boundary coverage.
4. `cmd /c npm.cmd test` passes.
5. `cmd /c npm.cmd run test:integration:connector-idempotency-semantics` passes.
6. `cmd /c npm.cmd run test:integration:marketplace-capability-gating` passes.
7. `cmd /c npm.cmd run test:integration:bulk-edit-empty-scope` passes.
8. `cmd /c npm.cmd run test:integration:media-ssrf-guard` passes.
9. Playwright signup/commercial flows either pass through wrapper scripts or are explicitly removed from beta scope.
10. `/admin/workspace`, `/settings*`, and `/reports` are either completed or hidden from launch-facing navigation and claims.
11. `INC-08` rollout evidence is closed.

## 4. Workstreams

### WS-P0-1 Tenant-scoped uniqueness and schema isolation

- Severity: P0
- Owner: Backend Lead + DB owner
- Why now:
  - PIM1 claims multi-tenant seller isolation.
  - Global uniqueness on SKU and category slug contradicts that claim.

#### Repo scope

- `packages/db/prisma/schema.prisma`
- new Prisma migration under `packages/db/prisma/migrations/`
- catalog and taxonomy write paths under `apps/api/src/catalog/` and `apps/api/src/taxonomy/`
- product and category tests under `apps/api/test/integration/`

#### Required implementation

1. Replace global uniqueness on:
   - `Variant.skuCode`
   - `Category.slug`
2. Move to tenant-scoped uniqueness:
   - planned target: `(tenant_key, skuCode)`
   - planned target: `(tenant_key, slug)` or equivalent explicit tenant-scoped category identity
3. Add a pre-migration duplicate scan so existing data collisions are surfaced before migration deploy.
4. Update any service code or admin flows that currently assume global SKU or global category slug uniqueness.

#### Planned validation tests

- `apps/api/test/integration/variant-tenant-uniqueness.test.cjs`
- `apps/api/test/integration/category-tenant-uniqueness.test.cjs`
- existing `apps/api/test/integration/rls-isolation.test.cjs`

#### Validation commands

- `cmd /c npm.cmd run prisma:generate`
- `cmd /c npm.cmd run test:integration:rls-isolation`
- `cmd /c npm.cmd run test:integration:variant-tenant-uniqueness` after adding the matching script
- `cmd /c npm.cmd run test:integration:category-tenant-uniqueness` after adding the matching script

#### Exit criteria

1. Same SKU can exist in two tenants without collision.
2. Duplicate SKU inside one tenant is rejected.
3. Same category slug can exist in two tenants without collision.
4. Duplicate category slug inside one tenant is rejected.
5. Existing product/category CRUD flows still pass.

### WS-P0-2 RLS-BYPASS reduction and trust-boundary hardening

- Severity: P0
- Owner: Backend Lead
- QA owner: QA Lead
- Why now:
  - Tenant isolation cannot depend on discipline alone.
  - Current `RLS-BYPASS` comments mark manual filtering in critical services.

#### Priority repo scope

- `apps/api/src/marketplace/marketplace.service.ts`
- `apps/api/src/media/media.service.ts`
- `apps/api/src/compliance/compliance.service.ts`
- `apps/api/src/audit/audit.service.ts`
- `apps/api/src/dashboard/dashboard.service.ts`
- `apps/api/src/billing/plan-usage.service.ts`

#### Required implementation

1. Inventory each `RLS-BYPASS` occurrence and classify it:
   - remove
   - replace with tenant-scoped Prisma path
   - retain only if it operates on truly global metadata and has explicit justification
2. Treat customer-data paths as first priority:
   - marketplace
   - media
   - compliance
3. Treat reporting/governance paths as second priority:
   - audit
   - dashboard
   - billing
4. Add service-level tenant-boundary tests for every retained raw-SQL path.

#### Planned validation tests

- `apps/api/test/integration/marketplace-tenant-boundary.test.cjs`
- `apps/api/test/integration/media-tenant-boundary.test.cjs`
- `apps/api/test/integration/compliance-tenant-boundary.test.cjs`
- `apps/api/test/integration/audit-tenant-boundary.test.cjs`
- `apps/api/test/integration/dashboard-tenant-boundary.test.cjs`
- `apps/api/test/integration/billing-tenant-boundary.test.cjs`

#### Validation commands

- `cmd /c npm.cmd run guard:unsafe-raw`
- `cmd /c npm.cmd run tenant:verify-rls:ci`
- `cmd /c npm.cmd run test:integration:rls-isolation`
- targeted tenant-boundary suite commands for each new test above after adding the matching scripts

#### Exit criteria

1. No unreviewed `RLS-BYPASS` paths remain in customer-data services.
2. Every retained manual-filter path has:
   - a written justification
   - an automated tenant-boundary test
3. `tenant:verify-rls:ci` passes.

### WS-P0-3 Core failing suite remediation

- Severity: P0
- Owner: QA Lead + Backend Lead
- Why now:
  - Launch confidence is currently weakened by real failing suites, not only environment noise.

#### Priority failing suites and code scope

| Suite | Current failure | Primary scope |
|---|---|---|
| `apps/api/test/integration/connector-idempotency-semantics.test.cjs` | `401 INVALID_CREDENTIALS` in root test path | `apps/api/src/connector-framework/connector-framework.service.ts`, test bootstrap in the suite |
| `apps/api/test/integration/marketplace-capability-gating.test.cjs` | `401 INVALID_CREDENTIALS` | `apps/api/src/marketplace/marketplace.service.ts`, `apps/api/src/connectors/meesho/meesho.connector.ts`, suite bootstrap |
| `apps/api/test/integration/bulk-edit-empty-scope.test.cjs` | `404 WORKSPACE_NOT_FOUND` | `apps/api/src/bulk-edit/bulk-edit.controller.ts`, `apps/api/src/bulk-edit/bulk-edit.service.ts`, suite bootstrap |
| `apps/api/test/integration/media-ssrf-guard.test.cjs` | `404 WORKSPACE_NOT_FOUND` | `apps/api/src/media/media.controller.ts`, `apps/api/src/media/media.service.ts`, suite bootstrap |

#### Common failure pattern to address first

These suites all:

1. spawn `apps/api/dist/main.js`
2. seed auth through env bootstrap such as:
   - `PIM_DEFAULT_TENANT_KEY`
   - `PIM_AUTH_IDENTITIES_JSON`
3. then call `/api/v1/auth/login`

This means the first repair pass should normalize the test bootstrap contract before changing business logic.

#### Required implementation

1. Standardize workspace/login bootstrap in the affected suites.
2. Make every suite explicit about whether it expects:
   - workspace slug login
   - default-tenant fallback
   - seeded workspace directory rows
3. Fix the business assertion only after bootstrap is deterministic.
4. Keep the root `npm test` chain green, not just standalone single-suite reruns.

#### Validation commands

- `cmd /c npm.cmd test`
- `cmd /c npm.cmd run test:integration:connector-idempotency-semantics`
- `cmd /c npm.cmd run test:integration:marketplace-capability-gating`
- `cmd /c npm.cmd run test:integration:bulk-edit-empty-scope`
- `cmd /c npm.cmd run test:integration:media-ssrf-guard`

#### Exit criteria

1. Root `npm test` passes.
2. All four failing suites above pass standalone.
3. No suite depends on undocumented local workspace or password assumptions.

### WS-P0-4 Harness and environment stabilization

- Severity: P0
- Owner: DevOps + QA Lead
- Why now:
  - Current verification results mix real defects with environment noise.

#### Repo scope

- `scripts/run-product-suite.cjs`
- wrapper scripts under `scripts/run-playwright-*.cjs`
- failing integration suites that call `spawn("node", [API_ENTRY], ...)`
- local Windows execution guidance

#### Required implementation

1. Remove Windows-local execution ambiguity:
   - until fully fixed, standardize validation docs on `cmd /c npm.cmd ...`
2. Investigate and close `spawn EPERM` in:
   - `apps/api/test/integration/env-validation.test.cjs`
   - `apps/api/test/integration/catalog-completeness.test.cjs`
   - `apps/api/test/integration/mapping-manager.test.cjs`
   - `apps/api/test/integration/bulk-import-tenant-boundary.test.cjs`
   - `scripts/run-product-suite.cjs`
3. Make Playwright signup/commercial flows use the wrapper scripts that provision outbox env:
   - `scripts/run-playwright-public-signup.cjs`
   - `scripts/run-playwright-admin-plan-signup-export.cjs`
   - `scripts/run-playwright-admin-plan-upgrade-request.cjs`
   - related wrapper scripts for internal commercial flows
4. Document one canonical local-validation entrypoint for Windows reviewers.

#### Validation commands

- `cmd /c npm.cmd run test:product`
- `cmd /c npm.cmd run test:integration:env-validation`
- `cmd /c npm.cmd run test:integration:catalog-completeness`
- `cmd /c npm.cmd run test:integration:mapping-manager`
- `cmd /c npm.cmd run test:integration:bulk-import-tenant-boundary`
- `cmd /c npm.cmd run test:e2e:public-signup`
- `cmd /c npm.cmd run test:e2e:admin-plan-signup-export`
- `cmd /c npm.cmd run test:e2e:admin-plan-upgrade-request`

#### Exit criteria

1. `spawn EPERM` is no longer the reason a critical validation suite fails.
2. Playwright signup/commercial wrappers pass or are explicitly removed from launch scope.
3. The product-suite command is usable as a real reviewer gate.

### WS-P1-5 Launch-surface cleanup

- Severity: P1
- Owner: Web Lead + Product
- Why now:
  - Partial or redirect-only launch surfaces weaken trust and inflate scope claims.

#### Repo scope

- `apps/web/src/app/admin/workspace/page.tsx`
- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/app/settings/plan/page.tsx`
- `apps/web/src/app/settings/privacy/page.tsx`
- `apps/web/src/app/settings/connectors/page.tsx`
- `apps/web/src/app/reports/page.tsx`
- `apps/web/src/components/nav/app-sidebar.tsx`

#### Required implementation

Choose one path and commit to it:

1. Complete the surfaces, or
2. Hide/remove them from production navigation and launch claims

Do not keep placeholder or redirect-only surfaces in beta-facing UX unless they are clearly labeled as aliases.

#### Validation commands

- `cmd /c npm.cmd run test:integration:legacy-alias-routes`
- `cmd /c npm.cmd run test:product:cleanup`
- route-contract tests for affected admin surfaces

#### Exit criteria

1. `/admin/workspace` is either real or removed from launch-facing nav.
2. `/settings*` and `/reports` are either:
   - documented aliases only, or
   - replaced by real product surfaces
3. Docs and UI claims match the actual route contract.

### WS-P1-6 Connector launch-truth alignment

- Severity: P1
- Owner: Product + Backend + Web
- Why now:
  - Current verified truth is narrower than generic “multi-channel ready” positioning.

#### Current truth

- `flipkart` -> `live`
- `amazon-in` -> `planned`
- `meesho` -> `manual`
- safe fallback slugs default to `["flipkart"]`

Evidence:

- `apps/api/src/connector-framework/connector-launch-policy.ts:19`
- `apps/api/src/connector-framework/connector-launch-policy.ts:28`
- `apps/api/src/connector-framework/connector-launch-policy.ts:52`

#### Required implementation

1. Keep launch messaging aligned to verified connector scope.
2. Do not market Amazon or Meesho as self-serve live channels.
3. Keep onboarding/install surfaces honest about capability gating.

#### Validation commands

- `cmd /c npm.cmd run test:integration:connector-capability-orchestration`
- `cmd /c npm.cmd run test:integration:marketplace-capability-ui-gating`
- `cmd /c npm.cmd run test:e2e:channels-connector-detail-drilldown`
- `cmd /c npm.cmd run test:e2e:channels-mapping-publish`

#### Exit criteria

1. Product copy, docs, and UI all match current connector maturity.
2. Beta scope is explicitly Flipkart-centered until additional connectors are proven.

### WS-P1-7 Rollout evidence closeout

- Severity: P1
- Owner: DevOps + QA Lead + Engineering Lead
- Why now:
  - Even after code hardening, controlled rollout evidence is still open.

#### Repo scope

- `docs/execution/CURRENT_STATE.md`
- `docs/execution/INCREMENT_STATE.json`
- `docs/execution/PROD_READINESS_RISK_REGISTER.md`
- `docs/execution/rollout/`
- rollout scripts in `scripts/`

#### Required implementation

1. Restore and record the missing E10 continuity.
2. Close the remaining broad-window observation gap.
3. Update the checked-in execution ledger only after evidence is real.

#### Validation commands

- `cmd /c npm.cmd run gate:signoff -- --suite E10-...`
- `cmd /c npm.cmd run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL`
- `cmd /c npm.cmd run test:staging:live-evidence`

#### Exit criteria

1. `INC-08` can be closed from evidence, not optimism.
2. Controlled rollout blockers are cleared in the checked-in snapshot.

## 5. Timeboxed roadmap

### Days 1-7

#### Goal

Remove the ambiguity between real code defects and harness defects.

#### Deliverables

1. Tenant uniqueness migration design complete, including duplicate-precheck script.
2. `RLS-BYPASS` inventory complete and classified by service.
3. Bootstrap contract fixed for:
   - `connector-idempotency-semantics`
   - `marketplace-capability-gating`
   - `bulk-edit-empty-scope`
   - `media-ssrf-guard`
4. One canonical Windows validation method documented: `cmd /c npm.cmd ...`
5. Decision made on `/admin/workspace`, `/settings*`, `/reports`: complete vs hide.

#### Validation gate

- `cmd /c npm.cmd run lint`
- `cmd /c npm.cmd run build`
- standalone reruns of the four critical failing suites
- no unresolved owner ambiguity on any P0 workstream

### Days 8-14

#### Goal

Land the tenant-safety fixes and get the critical suite pack green.

#### Deliverables

1. Tenant-scoped uniqueness migration merged.
2. New tenant-boundary tests merged and passing.
3. Critical `RLS-BYPASS` paths in marketplace/media/compliance are removed or defended.
4. Root `cmd /c npm.cmd test` passes.
5. `test:product` is no longer blocked by `spawn EPERM`.
6. Signup/commercial Playwright wrappers pass or are explicitly scoped out.

#### Validation gate

- `cmd /c npm.cmd test`
- `cmd /c npm.cmd run test:product`
- `cmd /c npm.cmd run tenant:verify-rls:ci`
- critical standalone suite pack
- selected Playwright wrapper flows

### Days 15-30

#### Goal

Close launch-scope honesty and rollout-proof gaps, then rerun the audit.

#### Deliverables

1. Launch-facing routes are either honest aliases or completed surfaces.
2. Connector scope messaging is aligned across UI, docs, and onboarding.
3. `INC-08` evidence gap is materially reduced or closed.
4. Fresh verification audit run completed against the stabilized repo state.

#### Validation gate

- rerun current-state verification
- compare blocker delta against `PIM1_LAUNCH_BLOCKERS.md`
- update readiness verdict only if all non-negotiable gates are met

## 6. Validation pack

### Build and baseline pack

- `cmd /c npm.cmd run lint`
- `cmd /c npm.cmd run build`
- `cmd /c npm.cmd test`

### Tenant-safety pack

- `cmd /c npm.cmd run prisma:generate`
- `cmd /c npm.cmd run tenant:verify-rls:ci`
- `cmd /c npm.cmd run test:integration:rls-isolation`
- planned tenant uniqueness and tenant-boundary suites

### Critical remediation pack

- `cmd /c npm.cmd run test:integration:connector-idempotency-semantics`
- `cmd /c npm.cmd run test:integration:marketplace-capability-gating`
- `cmd /c npm.cmd run test:integration:bulk-edit-empty-scope`
- `cmd /c npm.cmd run test:integration:media-ssrf-guard`

### Product-surface pack

- `cmd /c npm.cmd run test:integration:legacy-alias-routes`
- `cmd /c npm.cmd run test:product:cleanup`

### Browser proof pack

- `cmd /c npm.cmd run test:e2e:public-signup`
- `cmd /c npm.cmd run test:e2e:admin-plan-signup-export`
- `cmd /c npm.cmd run test:e2e:admin-plan-upgrade-request`
- `cmd /c npm.cmd run test:e2e:critical`

## 7. Final go/no-go rule

If tenant-scoped uniqueness, `RLS-BYPASS` hardening, critical suite recovery, and rollout evidence are not all closed, PIM1 remains:

- not broad-beta-ready
- not controlled-beta-ready

At that point the correct label remains:

- `Internal Ready` or
- `Design Partner Ready`

depending on how much of the validation pack is green.
