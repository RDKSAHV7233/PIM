# PIM1 Connector Current State (2026-03-08)

Status: Active review baseline  
Scope: Current PIM1 repository only  
Supersedes for implementation planning:
- `C:\Users\Om Computers\Downloads\PIM1_connector_plan_review_2026-03-04.docx`
- `C:\Users\Om Computers\Downloads\PIM1_CONNECTOR_DEVELOPER_GUIDE_FINAL_2026-03-06.pdf`

## 1. Purpose

This document records the current connector-development reality of PIM1 as of 2026-03-08.

Use this file for:
- sprint planning
- connector feature scoping
- documentation cleanup
- identifying which external connector documents are stale

Do not use the superseded external artifacts above as current engineering plans. They reference older file paths, older route surfaces, and pre-redesign UI assumptions.

## 2. Current Source of Truth

For connector work, trust these sources in this order:

1. `docs/product/PRD.md`
2. `docs/execution/INCREMENT_STATE.json`
3. Current code:
   - `apps/api/src/marketplace/**`
   - `apps/api/src/auth/**`
   - `apps/api/src/connector-framework/**`
   - `apps/web/src/app/channels/mappings/**`

Use these as supporting references, not sole planning truth:
- `docs/openapi.json`
- `docs/openapi.yaml`
- `docs/product/user-guide/**`
- downloaded connector artifacts outside the repo

Current note:
- `docs/openapi.json` and `docs/openapi.yaml` now include connector mapping rollback and `/api/v1/auth/step-up`
- `docs/product/user-guide/**` now reflects `/channels/mappings` as the canonical mapping route
- connector planning should still anchor on `PRD.md`, `INCREMENT_STATE.json`, and current code first

## 3. Executive Verdict

### Strategic state

- Connector mapping lifecycle: implemented
- Canonical mapping UI: implemented
- Step-up re-auth for high-risk mapping actions: implemented
- Rollback semantics: implemented
- Publish-readiness hard gate: implemented
- Hybrid connector discovery: implemented
- Broad rollout readiness: not complete

### Planning decision

Proceed with connector work only against the current PIM1 codebase and this document set.

Do not plan new work from the March 4 `.docx` or March 6 `.pdf` without rewriting their file references and capability assumptions first.

## 4. Current Connector Architecture

### 4.1 Runtime discovery

Current runtime discovery is hybrid, not fully dynamic.

Evidence:
- `apps/api/src/connector-framework/connector.registry.ts`

What it does now:
- runtime implementations are statically compiled into the Nest application
- active connector definitions in the database control which compiled implementations are exposed
- if DB discovery fails, the registry falls back to local compiled implementations

What it does not do:
- plugin-style runtime loading
- manifest-driven hot-loading of arbitrary third-party connectors

This matches `docs/product/PRD.md`:
- `CR-010`: hybrid discovery now, plugin/manifest discovery later

### 4.2 Mapping lifecycle

Current mapping lifecycle is implemented as:

`draft -> validated -> published -> superseded -> archived`

Evidence:
- controller: `apps/api/src/marketplace/marketplace.controller.ts`
- service: `apps/api/src/marketplace/connector-mapping.service.ts`
- schema/migration: `packages/db/prisma/migrations/20260306171000_connector_mapping_lifecycle_v1/migration.sql`

Implemented behavior:
- versioned mapping rows
- one published mapping per `(tenant, connector, category scope)`
- compatibility states
- publish-readiness evaluation
- explicit archive
- explicit rollback to prior published mapping through clone-and-publish semantics

### 4.3 High-risk action protection

High-risk mapping actions now require step-up re-authentication.

Evidence:
- step-up endpoint: `apps/api/src/auth/auth.controller.ts`
- guard/header contract: `apps/api/src/auth/step-up.guard.ts`
- protected mapping actions:
  - publish
  - rollback
  - archive
  in `apps/api/src/marketplace/marketplace.controller.ts`

Important wording rule:
- this is not MFA
- this is bounded step-up re-authentication

### 4.4 Canonical mapping UI

Canonical editable mapping surface:
- `/channels/mappings`

Evidence:
- `apps/web/src/app/channels/mappings/page.tsx`

Legacy route:
- `/connectors/[installationId]/mapping`

Current behavior:
- transition-only redirect to canonical mapping route

Evidence:
- `apps/web/src/app/connectors/[installationId]/mapping/page.tsx`

### 4.5 Product-side mapping flow

Product detail now routes mapping fixes to the canonical lifecycle mapping surface, not the legacy connector mapping path.

Evidence:
- `apps/web/src/app/products/[id]/page.tsx`

### 4.6 Structured mapping editor

Mapping authoring is no longer JSON-first for normal users.

Current state:
- structured field mapping controls exist
- fallback behavior is structured
- advanced JSON overrides still exist, but as secondary controls

Evidence:
- `apps/web/src/app/channels/mappings/page.tsx`
- `apps/web/src/app/actions.ts`

## 5. Current Capability Status

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
| Plugin-style connector discovery | Missing / future scope | see `docs/product/PRD.md` |
| Broad rollout evidence | Missing / incomplete | `docs/execution/INCREMENT_STATE.json` |

## 6. What Is Stale in the External Artifacts

### 6.1 March 4 review docx

The March 4 review doc is now historical only.

Still useful:
- it correctly called out wrong file references from an older architecture
- it correctly warned against rebuilding mapping from scratch

Now stale:
- it says mapping UI is missing
- it says rollback is missing
- it treats category-alignment and readiness support as more absent than they are now

### 6.2 March 6 final PDF

The March 6 PDF is not current SSOT anymore.

Stale claims include:
- `src/auth/protected-routes.ts` as the active connector route surface
- `db/01-schema.sql` as the current contract source
- `src/connectors/runtime/loader.ts` as the runtime binding file
- mapping UI still missing/planned

Current replacements:
- `apps/api/src/marketplace/marketplace.controller.ts`
- `apps/api/src/auth/auth.controller.ts`
- `packages/db/prisma/migrations/**`
- `apps/api/src/connector-framework/connector.registry.ts`
- `apps/web/src/app/channels/mappings/page.tsx`

## 7. Current Documentation Usage Notes

### Connector planning truth

Use these first:
- `docs/product/PRD.md`
- `docs/execution/INCREMENT_STATE.json`
- current code in `apps/api/src/marketplace/**`, `apps/api/src/auth/**`, `apps/api/src/connector-framework/**`, `apps/web/src/app/channels/mappings/**`

### Supporting references

- `docs/openapi.json` and `docs/openapi.yaml`
  - useful API contract references
  - currently include `/api/v1/auth/step-up` and rollback endpoints
  - still secondary to current code for connector planning
- `docs/product/user-guide/**`
  - current route and mapping-workflow guidance is largely aligned
  - generated guide content should still be treated as secondary when connector behavior changes

## 8. Current Release Reality for Connector Work

Connector subsystem maturity is stronger than the broad rollout state.

Current gate status:
- `INC-05`: still `in_progress`
- `INC-08`: still `in_progress`

Evidence:
- `docs/execution/INCREMENT_STATE.json`

Interpretation:
- connector lifecycle and UX work have advanced
- broad rollout approval has not
- connector work can proceed in controlled/internal mode
- broad production statements are still blocked by release evidence

## 9. Planning Rules From This Point

When planning the next connector sprint:

1. Use current PIM1 file paths only.
2. Do not reference:
   - `db/01-schema.sql`
   - `src/auth/protected-routes.ts`
   - `src/connectors/runtime/loader.ts`
   - `admin-ui`
3. Treat `/channels/mappings` as the only editable mapping surface.
4. Treat step-up re-authentication as the correct security term.
5. Treat plugin-style discovery as future scope, not current capability.
6. Do not use OpenAPI or generated user-guide files as the sole implementation truth; use them as supporting references after PRD, INCREMENT state, and current code.

## 10. Immediate Documentation Actions

### P1
- regenerate OpenAPI and connector user-guide content when connector endpoints or mapping workflow semantics change

### P2
- archive or mark superseded:
  - `PIM1_connector_plan_review_2026-03-04.docx`
  - `PIM1_CONNECTOR_DEVELOPER_GUIDE_FINAL_2026-03-06.pdf`

## 11. Final Decision

For connector planning today:

- Use this repo-based current-state document plus `docs/product/PRD.md`
- Use `docs/execution/INCREMENT_STATE.json` for gate truth
- Treat the March 4 docx and March 6 pdf as historical reference only

This is the current safe planning position for PIM1 connector work.
