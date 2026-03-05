# EXE-P1-005 Concurrency Conflict Protection Evidence (2026-02-28)

## Scope

Backlog item: `EXE-P1-005`  
Title: Concurrent edit conflict protection for products  
Acceptance: version check conflict path and deterministic UI error

## Implementation Summary

- Added optimistic version field to product model:
  - `packages/db/prisma/schema.prisma`
  - `packages/db/prisma/migrations/20260228105500_product_version_conflict_guard/migration.sql`
- Added API version check in product update flow:
  - `apps/api/src/catalog/dto/update-product.dto.ts` (`expectedVersion`)
  - `apps/api/src/catalog/catalog.service.ts` (409 conflict with `VERSION_CONFLICT` payload)
- Added UI deterministic conflict path:
  - `apps/web/src/app/actions.ts` (`updateProductAction` with conflict redirect)
  - `apps/web/src/app/products/[id]/page.tsx` (versioned edit form + conflict/success banners)
  - `apps/web/src/lib/api.ts` (`Product.version` typing)
- Added smoke validation script:
  - `tools/phase4/concurrency-smoke-test.ps1`

## Verification Commands

```powershell
npm run prisma:generate
powershell -ExecutionPolicy Bypass -File tools\phase4\concurrency-smoke-test.ps1
powershell -ExecutionPolicy Bypass -File tools\phase4\smoke-test.ps1
npm run lint
npm run build
```

## Key Results

- Prisma client generate: pass
- Concurrency smoke:

```json
{"productId":"cmm5vwr0s0003uxc8uzoh75by","createdVersion":1,"firstUpdateVersion":2,"conflictCode":"VERSION_CONFLICT","conflictCurrentVersion":2,"finalVersion":2,"finalStatus":"active","checkedAt":"2026-02-28T11:02:28"}
```

- Phase 4 regression smoke:

```json
{"goodJobId":"cmm5vx1kx0003uxtsyijgnnbg","goodJobStatus":"completed","goodSuccessRows":2,"mappingTitle":"product_name","bulkEditPreview":2,"bulkEditApplyId":"cmm5vx1tm000auxts5ehcg14s","bulkEditApplied":2,"badJobId":"cmm5vx1wk000guxts37gbj5rs","badFirstStatus":"retrying","badSecondStatus":"dead_letter","repairedRow":"cmm5vx1wn000huxtseko46jh9","repairedStatus":"success","badJobAfterFix":"completed","requeuedStatus":"completed","requeuedDlqRows":0,"checkedAt":"2026-02-28T11:02:42"}
```

- Full workspace lint/build: pass

## Conclusion

`EXE-P1-005` acceptance is satisfied: stale updates fail with deterministic `VERSION_CONFLICT` response, and UI follows a deterministic conflict path with clear retry messaging.
