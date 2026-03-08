# PIM1 Current State

- Date: 2026-03-08
- Repo HEAD: `5a64683`
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
| INC-05 | Ops and Observability | in_progress | delivery complete, release item pending |
| INC-06 | Decision Dashboards | completed | locked stories present |
| INC-07 | Governance and Compliance | completed | locked stories present |
| INC-08 | Release Readiness | in_progress | delivery complete, rollout observation pending |
| INC-09 | Connector Mapping Lifecycle + Publish Readiness | completed | locked stories present |

## 5. Pending Release Items
Source: `docs/execution/INCREMENT_STATE.json`

- `INC-05`: `RISK-P0-003 post-deploy verification live proof pending`
- `INC-08`: `RISK-P0-001 live staging health proof and 14-day broad rollout observation pending`

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

## 8. Recent Governance Closure
- `ST-UI-SELLER-CLARITY-001` was reopened for a documented frontend route regression on `/internal/developer`.
- Fix commit: `62953eb` (`fix(web): force internal developer route dynamic`)
- Relock commit: `5a64683` (`chore(execution): relock seller clarity story`)

## 9. Reviewer Guidance
- For product review: start with `docs/product/PRD.md`
- For execution/release review: use `docs/execution/CURRENT_STATE.md` + `docs/execution/INCREMENT_STATE.json`
- For page-by-page usage review: use `docs/product/user-guide/PAGE_ACTION_PLAYBOOK_INDEX.md`
- For API review: use `docs/openapi.yaml`
