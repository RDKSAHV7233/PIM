# ORBIT -> PIM1 Transfer Bundle (2026-03-06)

This bundle preserves PIM1-related work that was implemented in the ORBIT repo by mistake.
It is stored in PIM1 as source material for controlled porting into Nest/Next modules.

## Source provenance

- Source repo: `C:\Users\Om Computers\orbit`
- Destination repo: `C:\Users\Om Computers\PIM1`
- Transfer date: `2026-03-06`

## Files moved into PIM1

- `src/auth/connector-mapping.ts`
- `src/auth/pim1-taxonomy.ts`
- `src/auth/protected-routes.ts`
- `tests/t55.mapping-domain.integration.test.js`
- `admin-ui/src/pages/orbit-mappings.tsx`
- `admin-ui/src/pages/orbit-publish-readiness.tsx`
- `db/01-schema.sql`

## PIM1 alignment map

These files are related to PIM1 capabilities, but not directly runnable in PIM1 because architecture differs.

### 1) Mapping lifecycle + precedence domain

- ORBIT source: `src/auth/connector-mapping.ts`
- PIM1 target area:
  - `apps/api/src/marketplace/marketplace.service.ts`
  - `apps/api/src/marketplace/marketplace.controller.ts`
  - `packages/db/prisma/schema.prisma`
- Porting notes:
  - ORBIT uses Express + SQL table `connector_mapping_versions`
  - PIM1 uses Nest + Prisma model `ChannelMappingTemplate`
  - Requires Prisma schema migration before functional parity

### 2) Taxonomy search/unmapped/publish readiness

- ORBIT source:
  - `src/auth/pim1-taxonomy.ts`
  - mapping/readiness routes in `src/auth/protected-routes.ts`
- PIM1 target area:
  - `apps/api/src/taxonomy/*`
  - `apps/api/src/marketplace/*`
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/web/src/app/api/marketplace/readiness/route.ts`

### 3) UI pages added in ORBIT shell

- ORBIT source:
  - `admin-ui/src/pages/orbit-mappings.tsx`
  - `admin-ui/src/pages/orbit-publish-readiness.tsx`
- PIM1 target area:
  - `apps/web/src/app/channels/mappings/page.tsx`
  - `apps/web/src/app/channels/page.tsx`
  - `apps/web/src/lib/api.ts` (if additional API contracts are added)

### 4) Integration test reference

- ORBIT source: `tests/t55.mapping-domain.integration.test.js`
- PIM1 target area:
  - `apps/api/test/integration/` (Nest/Prisma integration style)
- Porting notes:
  - ORBIT test uses inline Express server + mocked `authDb`.
  - PIM1 tests run against Nest app bootstrap + Prisma tenant context.

## Decision

- This transfer is a **preservation move** to prevent code loss.
- No runtime wiring was changed in PIM1 by this transfer.
- Functional port should be done as explicit PIM1 stories (A2/B/C/D) with Prisma migrations and Nest routes.

## Expanded preservation (2026-03-06)

An expanded bundle was added under:

- `docs/ports/orbit-pim1-transfer-2026-03-06/expanded/files`
- `docs/ports/orbit-pim1-transfer-2026-03-06/expanded/patches`

Contents:

1. Direct copies of PIM1-related new ORBIT files/directories.
2. Git patch snapshots for ORBIT modified files that likely include PIM1-related deltas.

This ensures no morning implementation is lost before native PIM1 integration work begins.
