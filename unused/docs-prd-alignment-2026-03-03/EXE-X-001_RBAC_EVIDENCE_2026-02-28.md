# EXE-X-001 RBAC Baseline Evidence (2026-02-28)

## Scope

Backlog item: `EXE-X-001`  
Title: RBAC baseline (`admin` / `editor` / `viewer`) in API/UI  
Acceptance: role checks enforced and tested in API/UI

## Implementation Summary

- API RBAC guard added and registered globally:
  - `apps/api/src/common/rbac/roles.ts`
  - `apps/api/src/common/rbac/rbac.guard.ts`
  - `apps/api/src/app.module.ts`
- Admin-only governance endpoints enforced:
  - Taxonomy category + attribute write operations
  - Compliance rule write operations
- Default write access policy:
  - `admin`, `editor` can perform write operations
  - `viewer` is read-only
- Web role propagation + UI gating:
  - role normalization and request header forwarding (`x-pim-role`)
  - dashboard + product pages pass role on reads/writes
  - write controls hidden/blocked for `viewer`
  - taxonomy governance controls restricted to `admin`

## Verification Commands

```powershell
npm run lint --workspace @pim1/api
npm run lint --workspace @pim1/web
npm run build --workspace @pim1/api
npm run build --workspace @pim1/web
powershell -ExecutionPolicy Bypass -File tools\phase4\rbac-smoke-test.ps1
powershell -ExecutionPolicy Bypass -File tools\phase4\smoke-test.ps1
```

## Key Results

- API lint: pass
- Web lint: pass
- API build: pass
- Web build: pass
- RBAC smoke:

```json
{"health":"ok","adminCategoryId":"cmm5u4opz0001ux44luaqtgts","editorProductId":"cmm5u4orx0003ux4428le6wa2","adminAttributeId":"cmm5u4oxz0007ux44ecvy4ovn","viewerReadableProducts":1086,"checks":{"viewerAllowedReads":true,"editorAllowedCatalogWrite":true,"editorBlockedOnTaxonomyWrite":true,"viewerBlockedOnCatalogWrite":true,"adminAllowedTaxonomyWrite":true},"checkedAt":"2026-02-28T10:12:40"}
```

- Phase 4 regression smoke:

```json
{"goodJobId":"cmm5u4zmh0003uxko3ehl0fkd","goodJobStatus":"completed","goodSuccessRows":2,"mappingTitle":"product_name","bulkEditPreview":2,"bulkEditApplyId":"cmm5u4zxg000auxkoj0n0mueo","bulkEditApplied":2,"badJobId":"cmm5u501s000guxko0c6btir3","badFirstStatus":"retrying","badSecondStatus":"dead_letter","repairedRow":"cmm5u501v000huxkoucx41q1m","repairedStatus":"success","badJobAfterFix":"completed","requeuedStatus":"completed","requeuedDlqRows":0,"checkedAt":"2026-02-28T10:12:54"}
```

## Conclusion

`EXE-X-001` acceptance is satisfied: role checks are enforced in API and reflected in UI behavior, with passing lint/build and no regression in Phase 4 smoke flow.
