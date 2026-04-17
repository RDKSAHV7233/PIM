# Vexa PIM AI-to-Code Increment Execution Pack

Date: 2026-03-05  
Mode: Increment-first, practical execution  
Scope: Pending increments only (`INC-03`, `INC-05`, `INC-07`, `INC-08`)

## 1. Objective
Convert pending increment goals into implementation-ready work items that can be executed directly in code with deterministic validation and gate closure evidence.

## 2. Current Pending Increments
1. `INC-03` Connector Reliability
2. `INC-05` Ops and Observability
3. `INC-07` Governance and Compliance
4. `INC-08` Release Readiness

## 3. Global Execution Contract (for every task)
1. Declare `Increment ID`, `Task ID`, file scope before code changes.
2. Apply smallest safe diff; no unrelated refactor.
3. Validate with required commands before moving next task.
4. Record evidence artifact path under `docs/execution/gates/` or `docs/execution/rollout/`.
5. Update `docs/execution/INCREMENT_STATE.json` when task/increment status changes.

Common validation baseline:
```powershell
npm run lint --workspace @pim1/api
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/api
npm run build --workspace @pim1/web
```

---

## 4. Increment Pack: INC-03 Connector Reliability

### INC03-T01 ONDC feature isolation in API
- Goal: ONDC must not behave as default core path.
- File scope:
  - `apps/api/src/app.module.ts`
  - `apps/api/src/common/env-validation.ts`
  - `.env.example`
  - `.env-templates/.env.example`
- Implementation:
  1. Gate ONDC module wiring behind `FEATURE_ONDC_ENABLED`.
  2. Validate env schema includes this flag with safe default `false`.
  3. Add env template docs.
- Validation:
```powershell
npm run test:integration:env-validation
npm run build --workspace @pim1/api
```
- Exit criteria:
  - ONDC code path is disabled by default in non-internal environments.

### INC03-T02 ONDC isolation in web navigation
- Goal: Remove ONDC from standard user navigation and workflows.
- File scope:
  - `apps/web/src/components/nav/app-sidebar.tsx`
  - `apps/web/src/app/internal/developer/page.tsx`
  - `apps/web/src/app/ai/page.tsx`
  - `apps/web/src/app/ondc/page.tsx`
- Implementation:
  1. Hide ONDC links from primary nav.
  2. Keep ONDC only in internal/labs views behind feature flag.
  3. Ensure direct route behavior is explicit (404/feature-disabled view).
- Validation:
```powershell
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/web
```
- Exit criteria:
  - Seller-facing nav has no ONDC path.

### INC03-T03 Connector reliability regression gate
- Goal: Ensure connector behavior unchanged after isolation.
- Validation:
```powershell
npm run test:integration:connector-capability-orchestration
npm run test:integration:marketplace-capability-gating
npm run test:integration:connector-idempotency-semantics
```
- Exit criteria:
  - All connector reliability suites pass.

---

## 5. Increment Pack: INC-05 Ops and Observability

### INC05-T01 Dashboard cache hardening (multi-instance safe)
- Goal: Replace process-local cache dependency with shared strategy.
- File scope:
  - `apps/api/src/dashboard/dashboard.service.ts`
  - `apps/api/src/common/redis*.ts` (if existing)
  - `apps/api/src/app.module.ts` (module wiring only if needed)
- Implementation:
  1. Move readiness/catalog health cache to Redis keys with TTL.
  2. Keep deterministic fallback when Redis unavailable.
  3. Remove reliance on per-process `Map` for authoritative cache.
- Validation:
```powershell
npm run test:integration:dashboard-aggregations
npm run build --workspace @pim1/api
```
- Exit criteria:
  - Dashboard aggregation behavior is consistent across instances.

### INC05-T02 Post-deploy verification deepening
- Goal: Staging deploy verifies trust/isolation/reliability, not just health.
- File scope:
  - `.github/workflows/deploy-staging.yml`
  - `scripts/staging-postdeploy-check.cjs`
- Implementation:
  1. Ensure staging workflow runs critical integration checks post-deploy.
  2. Ensure failures block pipeline.
  3. Ensure signoff artifact includes `{environment, tenantId, date, gitTag, runUrl}`.
- Validation:
```powershell
npm run gate:run:increment
```
- Exit criteria:
  - CI staging deploy contains post-deploy test and signoff evidence step.

### INC05-T03 Ops gate closure evidence
- Goal: Close ops gate with repeatable evidence.
- Validation:
```powershell
npm run gate:run:increment
npm run gate:signoff -- --suite INC05-OPS-GATE --tenantId SMOKE_TENANT_LOCAL --runUrl local://pim1/inc05-ops-gate
npm run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL
```
- Exit criteria:
  - New gate and rollout artifacts exist and are linked in risk register.

---

## 6. Increment Pack: INC-07 Governance and Compliance

### INC07-T01 Onboarding checklist in product UI
- Goal: First-seller onboarding loop is visible and actionable.
- File scope:
  - `apps/web/src/app/dashboard/page.tsx`
  - `apps/web/src/components/*` (new checklist component)
  - `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md` (only if behavior changes)
- Implementation:
  1. Add onboarding checklist card with progress states.
  2. Wire checklist actions to existing flows (import, fix issues, publish/export).
  3. Keep role-aware visibility.
- Validation:
```powershell
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/web
```
- Exit criteria:
  - Dashboard gives explicit next-step guidance for first seller.

### INC07-T02 Workflow states maturity
- Goal: Product workflow states are explicit and auditable.
- File scope:
  - `apps/api/src/catalog/*` (status transitions)
  - `apps/web/src/app/catalog/products/*`
  - `apps/web/src/app/products/[id]/*`
  - `apps/api/src/audit/*` (if transition audit missing)
- Implementation:
  1. Ensure Draft/Review/Approved/Rejected states are enforced.
  2. Expose status transition actions by role.
  3. Record transition in audit log.
- Validation:
```powershell
npm run test:integration:issue-inbox
npm run test:integration:catalog-completeness
npm run build --workspace @pim1/api
npm run build --workspace @pim1/web
```
- Exit criteria:
  - Status lifecycle is visible in list/detail and auditable.

### INC07-T03 Empty-state governance
- Goal: No dead-end pages in seller workflows.
- File scope:
  - `apps/web/src/app/catalog/products/*`
  - `apps/web/src/app/operations/imports/*`
  - `apps/web/src/app/quality/issues/*`
- Implementation:
  1. Add action-oriented empty states.
  2. Add import-complete guidance into fix/publish flow.
- Validation:
```powershell
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/web
```
- Exit criteria:
  - All primary empty states provide explicit next action.

---

## 7. Increment Pack: INC-08 Release Readiness

### INC08-T01 Resolve staging env mismatch in health/signoff
- Goal: Health and gate artifacts consistently report `staging`.
- File scope:
  - `apps/api/src/health/*`
  - `.env.staging.example`
  - deploy workflow env injection sections
- Implementation:
  1. Fix source of `env` in health response.
  2. Ensure staging pipelines export correct runtime env.
- Validation:
```powershell
npm run gate:run:increment
```
- Exit criteria:
  - `/api/v1/health` returns `env=staging` on staging.

### INC08-T02 Controlled rollout evidence window start
- Goal: Begin strict 14-day evidence tracking.
- File scope:
  - `docs/execution/rollout/*`
  - `scripts/capture-controlled-rollout-snapshot.cjs`
  - `docs/execution/CONTROLLED_RELEASE_CHECKLIST.md`
- Implementation:
  1. Capture daily controlled rollout snapshots.
  2. Track SLO and gate pass trend fields.
  3. Maintain no-gap evidence chain.
- Validation:
```powershell
npm run rollout:snapshot -- --environment staging --tenantId SMOKE_TENANT_LOCAL
```
- Exit criteria:
  - Daily snapshot artifact exists with complete fields.

### INC08-T03 Increment release gate closure
- Goal: Move increment from in-progress to complete when objective proof exists.
- Validation:
```powershell
npm run gate:run:increment
npm run test
```
- Exit criteria:
  - `INC-08` can be marked `completed` in `INCREMENT_STATE.json` only after P0 blockers close.

---

## 8. Execution Order (Strict)
1. `INC03-T01` -> `INC03-T02` -> `INC03-T03`
2. `INC05-T01` -> `INC05-T02` -> `INC05-T03`
3. `INC07-T01` -> `INC07-T02` -> `INC07-T03`
4. `INC08-T01` -> `INC08-T02` -> `INC08-T03`

## 9. Definition of Done Per Increment
An increment is done only when:
1. All increment tasks are implemented.
2. All listed validation commands pass.
3. Evidence artifact paths are recorded.
4. `docs/execution/INCREMENT_STATE.json` is updated:
   - `status=completed`
   - lock metadata filled for all completed stories
   - pending risks removed or explicitly reclassified.
