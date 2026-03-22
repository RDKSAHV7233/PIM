# PIM1 Current State

- Date: 2026-03-22
- Repo HEAD: `b84077b`
- Scope: canonical snapshot of the current PIM1 implementation, execution ledger, and reviewer-facing documentation state

## 1. Canonical Source-of-Truth Files
- Product baseline: `docs/product/PRD.md`
- Product source index: `docs/product/PRD_SOURCES.md`
- Execution ledger: `docs/execution/INCREMENT_STATE.json`
- Engineering backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`
- OpenAPI references: `docs/openapi.yaml`, `docs/openapi.json`
- User guide bundle: `docs/product/user-guide/`

## 2. Current Implemented Web Shell
Source: `apps/web/src/components/nav/app-sidebar.tsx`

### Seller-facing primary sections currently implemented
- `Dashboard`
- `Products`
- `Catalog`
- `Channels`
- `Quality`
- `Operations`
- `Settings`

### Hidden by default from normal production navigation
- `Labs / Internal`
  - `Developer`
  - `AI Lab`
  - `DAM`
  - `ONDC`

## 3. Current Implemented Route Groups
Source: `apps/web/src/app/`

- `admin/`
- `ai/`
- `api/`
- `catalog/`
- `channels/`
- `connectors/`
- `consent/`
- `dashboard/`
- `internal/`
- `login/`
- `media/`
- `ondc/`
- `operations/`
- `products/`
- `quality/`
- `rejection/`
- `reports/`
- `settings/`

## 4. Increment Status Snapshot
Source: `docs/execution/INCREMENT_STATE.json`

| Increment | Name | Status | Notes |
|---|---|---|---|
| INC-01 | Seller Workflow Core | completed | locked stories present |
| INC-02 | Catalog Throughput | completed | locked stories present |
| INC-03 | Connector Reliability | completed | locked stories present |
| INC-04 | Security and Isolation | completed | locked stories present |
| INC-05 | Ops and Observability | completed | locked stories present; post-deploy verification risk closed |
| INC-06 | Decision Dashboards | completed | locked stories present |
| INC-07 | Governance and Compliance | completed | locked stories present |
| INC-08 | Release Readiness | in_progress | delivery complete; latest verified remote evidence re-opened the E10 continuity gate and broad rollout evidence remains at 6/14 days (SLO 7/14) from the 2026-03-20 snapshot |
| INC-09 | Connector Mapping Lifecycle + Publish Readiness | completed | locked stories present |
| INC-10 | Flipkart Publish Connector v1 | completed | locked stories present; connector implementation complete |
| INC-11 | Workspace Login and Tenant Discovery | completed | locked stories present |
| INC-12 | Connector Access Stability | completed | locked stories present |
| INC-13 | Connector Access Validation and Admin UX | completed | locked stories present |
| INC-14 | Mappings Workflow UX Restructure | completed | locked stories present |
| INC-15 | Hydration Stability for Form Primitives | completed | locked stories present |
| INC-16 | Product Test Architecture and UI UX Acceptance | completed | locked stories present |
| INC-17 | Catalog Delete UX | completed | locked stories present |
| INC-18 | Playwright E2E Coverage and Workflow Stabilization | completed | locked stories present |
| INC-19 | Performance Optimization Sprint | completed | locked stories present |
| INC-20 | Audit Explorer UI | completed | locked stories present |
| INC-21 | Billing Usage Read-Path Optimization | completed | locked stories present |

## 5. Pending Release Items
Source: `docs/execution/INCREMENT_STATE.json` and `docs/execution/PROD_READINESS_RISK_REGISTER.md`

- `INC-05` / `RISK-P0-003`: post-deploy verification pipeline is now live and green on CI. Gate artifact recording is operational. Status: **closed** in the risk register.
- `INC-08` / `RISK-P0-001`: latest verified remote evidence on `origin/main` (`f47a64e`) includes snapshot `2026-03-20T05-31-22.940Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`, which shows controlled rollout continuity is no longer clear: `consecutiveE10SignoffRuns = 1` and `controlledRollout.pending` contains `Need at least 2 consecutive E10 gate signoff artifacts.` Broad rollout evidence remains at **6 of 14 required days**, with production SLO trend evidence at **7 of 14 required days**. Scheduled staging E2E run `23328562994` failed the same day and must be triaged before the board is advanced again.
- `INC-10`: Flipkart connector implementation is complete in the increment ledger. It is no longer tracked as an open release item in `docs/execution/INCREMENT_STATE.json`.

## 6. Current Documentation State
- `docs/product/` is canonical for product scope and user-facing guidance.
- `docs/architecture/enterprise-docs/` is a generated reference bundle, not the primary source of truth.
- `docs/ports/` is historical transfer/reference material and should not be treated as the live implementation baseline.
- `docs/design/PIM1_UI_Design_Review.html` is design/reference material and not the live route contract.

## 7. Current Runtime Notes
- Local API entrypoint: `npm run dev:api`
- Local web entrypoint: `npm run dev:web`
- When local Next.js runtime artifacts become stale, use `tools/dev/recover-web-runtime.ps1`
- Local reviewer validation commonly uses:
  - `npm run lint --workspace @pim1/web`
  - `npm run build --workspace @pim1/web`
  - `npm run build --workspace @pim1/api`

## 8. Recent Governance Events
- `f47a64e` -- remote rollout evidence commit recorded the 2026-03-20 snapshot; latest evidence re-opened the controlled-gate continuity check
- `b6aa161` -- auth/privacy hardening: non-enumerating password reset, R2-backed export delivery, and fail-closed email delivery
- `34dacc8` -- add `console` email mode for staging while keeping production email delivery `resend`-only
- `b3d2578` -- retry transient staging post-deploy verification failures so rollout evidence is less noisy
- `d3ac876` -- connector `implementationStatus` field; amazon-in and meesho labeled as stub/partial
- `b0fdca2` -- `api.ts` split by domain (2034 lines -> 10 domain files + barrel)
- `bd47041` -- product detail page split (1322 lines -> 144-line shell + tab components)

## 9. Reviewer Guidance
- For product review: start with `docs/product/PRD.md`
- For execution/release review: use `docs/execution/CURRENT_STATE.md` + `docs/execution/INCREMENT_STATE.json`
- For page-by-page usage review: use `docs/product/user-guide/PAGE_ACTION_PLAYBOOK_INDEX.md`
- For API review: use `docs/openapi.yaml`
