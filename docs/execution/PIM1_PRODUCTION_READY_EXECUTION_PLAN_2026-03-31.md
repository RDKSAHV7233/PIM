---
title: PIM1 Production Readiness Execution Plan
status: proposed
owner: Product Owner + CTO + DevOps Architect + QA Lead + Web Lead + Backend Lead
last_updated: 2026-03-31
baseline_inputs:
  - PIM1_CURRENT_STATE_VERIFICATION.md
  - PIM1_LAUNCH_BLOCKERS.md
  - PIM1_TEST_COVERAGE_MATRIX.md
  - docs/execution/PIM1_TENANT_SAFETY_VERIFICATION_HARDENING_PLAN_2026-03-31.md
  - docs/execution/PROD_READINESS_RISK_REGISTER.md
---

# 1. Purpose

Define the shortest credible path from the current PIM1 state to production readiness.

This plan is based on current repository truth, not roadmap intent.

It treats the following as non-negotiable:

- tenant isolation is a release blocker
- mapping lifecycle, precedence, rollback, and step-up are critical and must stay green
- readiness gating and publish safety are launch-critical
- placeholder, redirect-only, internal-only, or non-prod-only surfaces do not count as launch-ready product scope
- docs are secondary to code, tests, route contracts, and validation runs

# 2. Current Position

## PO view

PIM1 has a real core product:

- product workflow is real
- issue inbox and approval queue are real
- dashboard, audit, privacy, notifications, API keys, and jobs are real
- mapping governance is materially implemented

PIM1 is not ready for production because the visible scope is still broader than the verified scope:

- `/admin/workspace` is not a complete settings product
- `/reports` and `/settings*` are aliases, not full modules
- connector maturity is uneven
- browser proof is not current after backend hardening

## CTO view

The platform is technically stronger than the earlier baseline:

- API build is green
- web build is green
- `npm test` passes on current HEAD
- `npm run test:product` passes on current HEAD
- tenant-scoped uniqueness is fixed for category slug and variant SKU
- several tenant-boundary hotspots were hardened and now have proof tests

Production is still blocked because trust-boundary consistency is incomplete in critical services:

- [connector-mapping.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/marketplace/connector-mapping.service.ts)
- [marketplace.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/marketplace/marketplace.service.ts)
- [auth.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/auth/auth.service.ts)
- [plan-usage.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/billing/plan-usage.service.ts)

## DevOps architect view

Validation quality improved, but the release program is not fully closed:

- browser E2E was not rerun after the final tenant-safety changes
- `INC-08` rollout evidence is still open in [INCREMENT_STATE.json](C:/Users/Om%20Computers/PIM1/docs/execution/INCREMENT_STATE.json)
- staging and rollout proof need a fresh signoff cycle after the latest code changes

# 3. Production-Ready Definition

PIM1 is production-ready only when all of the following are true:

1. No release-blocking tenant-isolation gaps remain in critical runtime services.
2. Mapping lifecycle, precedence, rollback, step-up, readiness gating, and export safety are green on current HEAD.
3. The claimed product scope matches the real product scope.
4. Browser E2E proof is current.
5. Connector launch claims match connector maturity.
6. Rollout evidence and signoff are current, reproducible, and checked in.

# 4. Program Rules

## Scope rule

No new product scope until all P0 workstreams below are closed.

## Launch-claim rule

Do not claim multi-channel seller readiness. Current safe claim is Flipkart-centered until the other connectors are proven at the same level.

## Surface-honesty rule

Do not expose or market redirect-only, placeholder, or admin/non-prod surfaces as production modules.

## Verification rule

Every workstream closes only with passing commands and stored evidence.

# 5. Workstreams

## WS-P0-1 Tenant Trust Boundary Completion

- Priority: P0
- Executive owner: CTO
- Delivery owner: Backend Lead
- Supporting owners: QA Lead, DB owner
- Why it matters:
  - This is the remaining release-blocking architecture risk.

### Current evidence

- Raw/manual tenant enforcement remains in:
  - [connector-mapping.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/marketplace/connector-mapping.service.ts#L205)
  - [marketplace.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/marketplace/marketplace.service.ts#L423)
  - [auth.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/auth/auth.service.ts#L701)
  - [plan-usage.service.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/billing/plan-usage.service.ts#L589)

### Scope

- `apps/api/src/marketplace/connector-mapping.service.ts`
- `apps/api/src/marketplace/marketplace.service.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/billing/plan-usage.service.ts`
- matching integration tests under `apps/api/test/integration/`

### Required outcomes

1. Replace raw/manual tenant filtering in critical customer-data paths with tenant-scoped Prisma or equivalent authoritative scoping.
2. If any raw SQL remains, each occurrence must have:
   - written justification
   - explicit tenant filter proof
   - dedicated boundary test
3. Extend tenant-boundary coverage to mapping, publish/submission, auth/privacy, and billing search paths.

### Validation

- `cmd /c npm.cmd run guard:unsafe-raw`
- `cmd /c npm.cmd run tenant:verify-rls:ci`
- `node apps/api/test/integration/rls-isolation.test.cjs`
- `node apps/api/test/integration/connector-mapping-precedence.test.cjs`
- `node apps/api/test/integration/connector-mapping-rollback.test.cjs`
- `node apps/api/test/integration/connector-mapping-step-up.test.cjs`
- new targeted cross-tenant tests for mapping, submission, auth/privacy, and billing

### Exit criteria

1. No unreviewed raw/manual tenant paths remain in the four critical services.
2. Every retained exception is documented and covered by tests.
3. Tenant leakage is not reproducible in the critical publish/governance paths.

## WS-P0-2 Publish Safety Preservation

- Priority: P0
- Executive owner: CTO
- Delivery owner: Backend Lead
- Supporting owners: QA Lead
- Why it matters:
  - These are already strong and must not regress during the isolation work.

### Current evidence

- [connector-mapping-lifecycle.test.cjs](C:/Users/Om%20Computers/PIM1/apps/api/test/integration/connector-mapping-lifecycle.test.cjs)
- [connector-mapping-precedence.test.cjs](C:/Users/Om%20Computers/PIM1/apps/api/test/integration/connector-mapping-precedence.test.cjs)
- [connector-mapping-rollback.test.cjs](C:/Users/Om%20Computers/PIM1/apps/api/test/integration/connector-mapping-rollback.test.cjs)
- [connector-mapping-step-up.test.cjs](C:/Users/Om%20Computers/PIM1/apps/api/test/integration/connector-mapping-step-up.test.cjs)
- [marketplace-readiness-batch.test.cjs](C:/Users/Om%20Computers/PIM1/apps/api/test/integration/marketplace-readiness-batch.test.cjs)
- [connector-idempotency-semantics.test.cjs](C:/Users/Om%20Computers/PIM1/apps/api/test/integration/connector-idempotency-semantics.test.cjs)

### Scope

- `apps/api/src/marketplace/`
- `apps/api/src/auth/step-up.guard.ts`
- mapping and submission integration suites

### Required outcomes

1. Keep mapping allowed states unchanged unless a deliberate migration is approved.
2. Keep precedence deterministic.
3. Keep rollback auditable and version-safe.
4. Keep publish/export blocked server-side when readiness fails.
5. Keep step-up mandatory for high-risk mapping actions.

### Validation

- `node apps/api/test/integration/connector-mapping-lifecycle.test.cjs`
- `node apps/api/test/integration/connector-mapping-precedence.test.cjs`
- `node apps/api/test/integration/connector-mapping-rollback.test.cjs`
- `node apps/api/test/integration/connector-mapping-step-up.test.cjs`
- `node apps/api/test/integration/marketplace-readiness-batch.test.cjs`
- `cmd /c npm.cmd run test:integration:submission-lifecycle-api`
- `cmd /c npm.cmd run test:integration:connector-idempotency-semantics`

### Exit criteria

1. All critical mapping/publish safety suites remain green.
2. No code change weakens step-up or readiness gating.

## WS-P0-3 Browser and Product Validation Refresh

- Priority: P0
- Executive owner: DevOps Architect
- Delivery owner: QA Lead
- Supporting owners: Web Lead, Backend Lead
- Why it matters:
  - Current browser confidence is stale after backend hardening.

### Current evidence

- Playwright commands exist in [package.json](C:/Users/Om%20Computers/PIM1/package.json)
- prior audit explicitly marked browser rerun as UNVERIFIED after the latest backend changes

### Scope

- `apps/web/test/e2e/`
- Playwright wrapper scripts under `scripts/`
- any env bootstrap required by `playwright.config.cjs`

### Required outcomes

1. Rerun the critical browser pack on current HEAD.
2. Rerun signup/commercial flows through the wrapper scripts that manage the outbox env.
3. Treat every failing browser flow as a real blocker until proved otherwise.

### Validation

- `cmd /c npm.cmd run test:e2e:critical`
- `cmd /c npm.cmd run test:e2e:public-signup`
- `cmd /c npm.cmd run test:e2e:admin-plan-signup-export`
- `cmd /c npm.cmd run test:e2e:admin-plan-upgrade-request`
- `cmd /c npm.cmd run test:e2e:internal-commercial-ops`
- `cmd /c npm.cmd run test:e2e:internal-commercial-audit-followup`

### Exit criteria

1. Browser proof is current on the hardened backend.
2. Any skipped or removed flow is explicitly scoped out of launch.

## WS-P0-4 Surface Scope Cleanup

- Priority: P0
- Executive owner: Product Owner
- Delivery owner: Web Lead
- Supporting owners: Design, QA Lead
- Why it matters:
  - Production scope must match what users can actually use.

### Current evidence

- [admin/workspace/page.tsx](C:/Users/Om%20Computers/PIM1/apps/web/src/app/admin/workspace/page.tsx)
- [reports/page.tsx](C:/Users/Om%20Computers/PIM1/apps/web/src/app/reports/page.tsx)
- [settings/page.tsx](C:/Users/Om%20Computers/PIM1/apps/web/src/app/settings/page.tsx)

### Scope

- `apps/web/src/app/admin/workspace/page.tsx`
- `apps/web/src/app/reports/page.tsx`
- `apps/web/src/app/settings/`
- `apps/web/src/components/nav/app-sidebar.tsx`
- route-contract tests under `apps/web/test/integration/`

### Required outcomes

Choose one of these for each partial surface:

1. Finish it into a real production module, or
2. Hide it from production navigation and launch claims

### Validation

- `cmd /c npm.cmd run test:integration:legacy-alias-routes`
- `cmd /c npm.cmd run test:product:cleanup`
- route-contract tests for the affected pages

### Exit criteria

1. `/admin/workspace` is either real or removed from launch-facing scope.
2. `/reports` and `/settings*` are either honest aliases or replaced with real modules.
3. Navigation, docs, and launch messaging match runtime truth.

## WS-P0-5 Connector Scope Honesty

- Priority: P0
- Executive owner: Product Owner
- Delivery owner: Product + Backend Lead
- Supporting owners: Web Lead, QA Lead
- Why it matters:
  - Production claims cannot outrun connector maturity.

### Current evidence

- [connector-launch-policy.ts](C:/Users/Om%20Computers/PIM1/apps/api/src/connector-framework/connector-launch-policy.ts)
  - `amazon-in` -> `planned`
  - `meesho` -> `manual`
  - fallback -> `flipkart`

### Scope

- `apps/api/src/connector-framework/connector-launch-policy.ts`
- `apps/web/src/app/connectors/page.tsx`
- connector onboarding and capability UI tests
- docs that describe connector availability

### Required outcomes

1. Keep Flipkart as the proven seller-ready path.
2. Do not market Amazon or Meesho as equivalent self-serve production channels.
3. Make capability gating visible and honest in UI and docs.

### Validation

- `cmd /c npm.cmd run test:integration:connector-capability-orchestration`
- `cmd /c npm.cmd run test:integration:marketplace-capability-ui-gating`
- `cmd /c npm.cmd run test:e2e:channels-connector-detail-drilldown`

### Exit criteria

1. Product copy, route behavior, and docs all match actual connector maturity.
2. No seller-facing surface implies unsupported channel parity.

## WS-P1-6 Staging and Rollout Signoff Refresh

- Priority: P1
- Executive owner: DevOps Architect
- Delivery owner: DevOps + QA Lead
- Supporting owners: CTO
- Why it matters:
  - Production readiness needs current operational proof, not only local proof.

### Current evidence

- [CURRENT_STATE.md](C:/Users/Om%20Computers/PIM1/docs/execution/CURRENT_STATE.md)
- [PROD_READINESS_RISK_REGISTER.md](C:/Users/Om%20Computers/PIM1/docs/execution/PROD_READINESS_RISK_REGISTER.md)
- [INCREMENT_STATE.json](C:/Users/Om%20Computers/PIM1/docs/execution/INCREMENT_STATE.json)

### Scope

- `docs/execution/CURRENT_STATE.md`
- `docs/execution/PROD_READINESS_RISK_REGISTER.md`
- `docs/execution/INCREMENT_STATE.json`
- rollout scripts under `scripts/`
- GitHub Actions staging evidence

### Required outcomes

1. Refresh staging deploy proof after the latest code changes.
2. Restore consecutive E10 signoff continuity.
3. Update checked-in rollout evidence only after real proof exists.

### Validation

- `cmd /c npm.cmd run gate:signoff -- --suite E10-...`
- `cmd /c npm.cmd run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL`
- `cmd /c npm.cmd run test:staging:live-evidence`

### Exit criteria

1. `INC-08` no longer blocks controlled rollout on stale or incomplete evidence.
2. Staging signoff is current and reproducible.

## WS-P1-7 Docs and Audit Refresh

- Priority: P1
- Executive owner: Product Owner
- Delivery owner: QA Lead
- Supporting owners: CTO, Web Lead, Backend Lead
- Why it matters:
  - Current root audit docs lag the hardened codebase.

### Scope

- `PIM1_CURRENT_STATE_VERIFICATION.md`
- `PIM1_VERIFICATION_FINDINGS.csv`
- `PIM1_TEST_COVERAGE_MATRIX.md`
- `PIM1_DOCS_VS_CODE_TRUTH.md`
- `PIM1_LAUNCH_BLOCKERS.md`

### Required outcomes

1. Refresh the five audit artifacts against the current hardened repo state.
2. Remove stale statements that were true only before the latest remediation.
3. Keep unresolved blockers explicit.

### Validation

- rerun the current-state verification
- compare old vs new blocker list
- confirm every important claim has an evidence path

### Exit criteria

1. Repo artifacts and repo truth match.
2. Launch review can rely on checked-in docs again.

# 6. Delivery Sequence

## Phase 1: Close release-blocking architecture risk

- WS-P0-1 Tenant Trust Boundary Completion
- WS-P0-2 Publish Safety Preservation

Reason:
- tenant isolation is the true release blocker
- mapping/publish safety is the most sensitive area touched by that work

## Phase 2: Refresh end-to-end confidence

- WS-P0-3 Browser and Product Validation Refresh
- rerun root local validation pack

Reason:
- production decisions should be based on current proof, not old proof

## Phase 3: Reduce scope dishonesty

- WS-P0-4 Surface Scope Cleanup
- WS-P0-5 Connector Scope Honesty

Reason:
- even a technically sound product is not launch-ready if the exposed scope is misleading

## Phase 4: Refresh operational signoff

- WS-P1-6 Staging and Rollout Signoff Refresh
- WS-P1-7 Docs and Audit Refresh

Reason:
- current code quality must be reflected in the release ledger and signoff materials

# 7. Timeboxed Roadmap

## Days 1-7

Goal:
- remove tenant-isolation ambiguity from critical services

Deliverables:

1. Inventory and classify all remaining raw/manual tenant paths in the four critical services.
2. Land the highest-risk refactors in mapping and publish flows.
3. Add missing cross-tenant tests for mapping, submission, auth/privacy, and billing.
4. Keep all existing critical mapping/readiness/step-up tests green.

Gate:

- `cmd /c npm.cmd run guard:unsafe-raw`
- `cmd /c npm.cmd run tenant:verify-rls:ci`
- mapping critical pack passes

## Days 8-14

Goal:
- restore current browser and product confidence

Deliverables:

1. Rerun product suite and browser critical suite on the hardened backend.
2. Triage and fix any E2E regressions.
3. Make a firm PO decision on `/admin/workspace`, `/reports`, and `/settings*`.
4. Align connector launch messaging to current truth.

Gate:

- `cmd /c npm.cmd test`
- `cmd /c npm.cmd run test:product`
- browser critical pack passes or explicit launch-scope removals are documented

## Days 15-30

Goal:
- close release signoff and freeze launch scope

Deliverables:

1. Refresh staging evidence and rollout signoff.
2. Refresh current-state audit artifacts.
3. Re-evaluate the readiness verdict.

Gate:

- rollout evidence is current
- no P0 blockers remain
- launch claim matches verified scope

# 8. Production Go/No-Go Checklist

## Must be true

- tenant isolation is closed in critical services
- mapping lifecycle, precedence, rollback, step-up stay green
- readiness gating and export safety stay green
- root validation pack passes
- browser critical pack is current
- product scope is honest
- connector scope is honest
- staging and rollout evidence are current

## If any are false

Do not move PIM1 to production.

The correct intermediate labels remain:

- Internal Ready, or
- Design Partner Ready

depending on the amount of current proof.

# 9. Validation Pack

## Local engineering gate

- `cmd /c npm.cmd run lint`
- `cmd /c npm.cmd run build`
- `cmd /c npm.cmd test`
- `cmd /c npm.cmd run test:product`

## Critical domain gate

- `cmd /c npm.cmd run tenant:verify-rls:ci`
- `node apps/api/test/integration/connector-mapping-lifecycle.test.cjs`
- `node apps/api/test/integration/connector-mapping-precedence.test.cjs`
- `node apps/api/test/integration/connector-mapping-rollback.test.cjs`
- `node apps/api/test/integration/connector-mapping-step-up.test.cjs`
- `node apps/api/test/integration/marketplace-readiness-batch.test.cjs`
- `cmd /c npm.cmd run test:integration:submission-lifecycle-api`
- `cmd /c npm.cmd run test:integration:connector-idempotency-semantics`

## Browser and UI gate

- `cmd /c npm.cmd run test:e2e:critical`
- `cmd /c npm.cmd run test:e2e:public-signup`
- `cmd /c npm.cmd run test:e2e:admin-plan-signup-export`
- `cmd /c npm.cmd run test:e2e:admin-plan-upgrade-request`
- `cmd /c npm.cmd run test:integration:legacy-alias-routes`

## Release gate

- `cmd /c npm.cmd run gate:signoff -- --suite E10-...`
- `cmd /c npm.cmd run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL`
- `cmd /c npm.cmd run test:staging:live-evidence`

# 10. Ownership and Cadence

## Daily

- Backend Lead + QA Lead:
  - tenant-boundary status
  - failing test status
  - regressions against mapping/readiness/step-up
- Web Lead + Product Owner:
  - surface-scope decisions
  - launch-copy truth
- DevOps Architect:
  - current validation signal
  - staging evidence status

## Twice weekly

- CTO review:
  - trust-boundary burndown
  - release gate status
  - scope-freeze compliance

## Weekly

- PO + CTO + DevOps go/no-go checkpoint:
  - Are P0 blockers still open?
  - Is the launch claim narrower, equal to, or broader than verified truth?
  - Should PIM1 remain Internal Ready, Design Partner Ready, or move forward?

# 11. Bottom Line

The shortest path to production is not adding features.

It is:

1. finish tenant-isolation hardening in the remaining critical services
2. preserve mapping and publish safety while doing that work
3. refresh browser and rollout proof on the new baseline
4. narrow visible scope to what is actually production-complete
5. refresh the audit ledger and signoff materials

Until those are done, PIM1 should not be described as production-ready.
