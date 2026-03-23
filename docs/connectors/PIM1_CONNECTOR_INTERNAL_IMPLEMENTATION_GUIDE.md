# PIM1 Connector Internal Implementation Guide

Status: Active internal engineering guide  
Date: 2026-03-23  
Audience: Engineers changing connector internals in the PIM1 repository

## 1. Purpose

This guide is repo-first.

Use it for:
- connector implementation planning against live code
- connector lifecycle changes
- mapping/readiness integration work
- connector UX integration work
- code review against the current PIM1 connector model

Do not use older external artifacts as implementation authority. They are historical only.

## 2. Source of Truth

For connector work, trust these sources in this order:

1. `docs/product/PRD.md`
2. `docs/execution/INCREMENT_STATE.json`
3. Current code:
   - `apps/api/src/marketplace/**`
   - `apps/api/src/auth/**`
   - `apps/api/src/connector-framework/**`
   - `apps/web/src/app/channels/mappings/**`
   - `packages/db/prisma/**`

Supporting references:
- `docs/openapi.json`
- `docs/openapi.yaml`
- `docs/product/user-guide/**`

Historical context only:
- `docs/archive/connectors/` once archived
- `docs/connectors/PIM1_CONNECTOR_CURRENT_STATE_2026-03-08.md` as a compatibility pointer

## 3. Current Connector Model

### Current-state summary

As of 2026-03-23:
- mapping lifecycle exists
- rollback exists
- step-up re-authentication exists for high-risk mapping actions
- canonical editable mapping path is `/channels/mappings`
- legacy connector mapping path is transition-only
- runtime discovery is hybrid, not plugin-dynamic
- broad rollout readiness is still blocked under `INC-08` rollout evidence

### Runtime model

PIM1 uses a hybrid connector runtime.

Current behavior:
- connector implementations are compiled into the Nest app
- database connector definitions decide which compiled connectors are active
- registry fallback uses local compiled implementations if DB discovery fails

Primary file:
- `apps/api/src/connector-framework/connector.registry.ts`

Not current capability:
- manifest/plugin hot-loading
- arbitrary third-party runtime loading

### Capability model

Connector behavior branches by capability.

Examples:
- export-only channels complete through export artifact flow
- publish-capable channels allow direct submission/publish attempts

Current capability enforcement is expected in:
- backend service/controller checks
- seller-facing UI gating

### Current capability status

| Capability | Current status | Evidence |
|---|---|---|
| Connector runtime registry | Exists (hybrid) | `apps/api/src/connector-framework/connector.registry.ts` |
| Mapping lifecycle | Exists | `apps/api/src/marketplace/connector-mapping.service.ts` |
| Mapping rollback | Exists | `apps/api/src/marketplace/marketplace.controller.ts`, `apps/api/src/marketplace/connector-mapping.service.ts` |
| Step-up re-auth for mapping publish/archive/rollback | Exists | `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/step-up.guard.ts` |
| Publish-readiness hard gate | Exists | `apps/api/src/marketplace/marketplace.controller.ts`, `apps/api/src/marketplace/connector-mapping.service.ts` |
| Canonical mapping UI | Exists | `apps/web/src/app/channels/mappings/page.tsx` |
| Legacy mapping editor demotion | Exists | `apps/web/src/app/connectors/[installationId]/mapping/page.tsx` |
| Structured mapping editor | Exists | `apps/web/src/app/channels/mappings/page.tsx` |
| Plugin-style connector discovery | Missing / future scope | `docs/product/PRD.md` |
| Broad rollout evidence | Missing / incomplete | `docs/execution/INCREMENT_STATE.json` |

## 4. Canonical Connector UX Paths

Canonical editable mapping route:
- `/channels/mappings`

Transition-only legacy route:
- `/connectors/[installationId]/mapping`

Current behavior:
- legacy route redirects to the canonical lifecycle mapping flow
- product detail should send users to `/channels/mappings` for mapping fixes

Primary files:
- `apps/web/src/app/channels/mappings/page.tsx`
- `apps/web/src/app/connectors/[installationId]/mapping/page.tsx`
- `apps/web/src/app/products/[id]/page.tsx`

Rule:
- do not introduce a second editable mapping surface

## 5. Mapping Lifecycle

Current lifecycle:

`draft -> validated -> published -> superseded -> archived`

Current behavior includes:
- versioned mapping rows
- one published mapping per `(tenant, connector, categoryScope)`
- compatibility states
- explicit archive
- explicit rollback through clone-and-publish semantics

Primary files:
- `apps/api/src/marketplace/connector-mapping.service.ts`
- `apps/api/src/marketplace/marketplace.controller.ts`
- `packages/db/prisma/migrations/20260306171000_connector_mapping_lifecycle_v1/migration.sql`

## 6. Security Model for Connector Actions

High-risk mapping actions require **step-up re-authentication**.

Protected actions:
- publish mapping version
- rollback mapping version
- archive mapping version

Primary files:
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/step-up.guard.ts`
- `apps/api/src/auth/jwt.ts`
- `apps/web/src/app/actions.ts`

Important terminology:
- use `step-up re-authentication`
- do not describe the current implementation as `MFA`

## 7. Current API Surfaces

Use the OpenAPI files as reference, but verify behavior against controller/service code.

Primary current endpoints:
- `POST /api/v1/auth/step-up`
- `GET /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/validate`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/publish`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/rollback`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/versions/{versionId}/archive`
- `GET /api/v1/marketplace/connectors/{connectorSlug}/mappings/resolve`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/preflight`
- `GET /api/v1/marketplace/connectors/{connectorSlug}/taxonomy/search`
- `GET /api/v1/marketplace/connectors/{connectorSlug}/taxonomy/unmapped`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/publish-readiness`

Primary files:
- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/src/auth/auth.controller.ts`
- `docs/openapi.yaml`
- `docs/openapi.json`

## 8. Current UI Expectations

Connector UX should reflect the product-first PIM workflow:

`Product -> Fix blockers -> Check readiness -> Publish/Export`

What connector UX should do:
- support readiness correction
- support lifecycle mapping changes
- expose connector capability truthfully
- keep diagnostics secondary to product work

What connector UX should not do:
- surface internal runtime concepts as primary user language
- reintroduce legacy template-first mapping editing
- show `Publish` for export-only capability paths

Primary files:
- `apps/web/src/app/channels/mappings/page.tsx`
- `apps/web/src/app/catalog/products/page.tsx`
- `apps/web/src/app/products/[id]/page.tsx`

## 9. Implementation Rules

When building connector features:

1. Use current PIM1 paths only.
2. Treat `/channels/mappings` as the only editable mapping surface.
3. Treat old template routes/surfaces as transition-only unless explicitly retired.
4. Keep capability truth aligned across backend and UI.
5. Use step-up re-authentication for high-risk mapping actions.
6. Do not design against plugin-style connector discovery unless that work is explicitly reopened.

Do not target these old surfaces:
- `db/01-schema.sql`
- `src/auth/protected-routes.ts`
- `src/connectors/runtime/loader.ts`
- `admin-ui`

## 10. Development Checklist

For a connector-related change, verify:

- backend contract updated in `apps/api/src/marketplace/**` if needed
- auth/step-up integration updated in `apps/api/src/auth/**` if needed
- registry/runtime impact checked in `apps/api/src/connector-framework/**`
- Prisma schema/migration updated in `packages/db/prisma/**` if needed
- canonical mapping UI updated in `apps/web/src/app/channels/mappings/**` if needed
- product/workbench integration updated if seller workflow changes
- OpenAPI regenerated
- user-guide regenerated when route/action behavior changes
- `docs/execution/INCREMENT_STATE.json` updated if a connector story is completed

## 11. Validation Checklist

Minimum repo checks after connector changes:

- `npm run openapi:generate`
- `python scripts/generate_page_action_playbooks.py`
- relevant API build/test commands for the touched area
- relevant web build/test commands for the touched area
- `node -e "JSON.parse(require('fs').readFileSync('docs/execution/INCREMENT_STATE.json','utf8')); console.log('INCREMENT_STATE.json valid')"`

If connector lifecycle behavior changes, also verify:
- mapping lifecycle tests
- precedence/compatibility tests
- rollback tests
- step-up tests
- capability gating tests

## 12. Release Reality

Connector implementation maturity is ahead of broad rollout readiness.

Current release gate reality:
- `INC-08` / `RISK-P0-001` is still open

Latest checked-in execution truth:
- snapshot `2026-03-22T05-34-42.984Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`
- `consecutiveE10SignoffRuns = 0`
- `controlledRollout.pending` still contains `Need at least 2 consecutive E10 gate signoff artifacts.`
- broad rollout evidence: `7 / 14` days
- SLO trend evidence: `7 / 14` days

That means:
- connector development can continue in controlled/internal mode
- broad production rollout is still blocked by release evidence outside this guide

Primary gate file:
- `docs/execution/INCREMENT_STATE.json`

## 13. Historical Artifacts

Historical connector artifacts should be retained for traceability, but never used as current implementation plans.

Archive location:
- `docs/archive/connectors/`

Current active docs supersede those artifacts.

### Superseded external artifacts

These older documents are historical only and should not drive current implementation:
- `PIM1_connector_plan_review_2026-03-04.docx`
- `PIM1_CONNECTOR_DEVELOPER_GUIDE_FINAL_2026-03-06.pdf`

They are stale because they reference older paths and predate:
- lifecycle mapping in `apps/api/src/marketplace/**`
- rollback support
- step-up re-authentication
- canonical `/channels/mappings` UI

## 14. Final Rule

If connector docs, OpenAPI, user-guide, and code disagree:

1. `PRD.md`
2. `INCREMENT_STATE.json`
3. current code

win over everything else.
