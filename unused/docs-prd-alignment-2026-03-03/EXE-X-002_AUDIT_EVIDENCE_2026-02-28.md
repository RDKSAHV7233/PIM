# EXE-X-002 Audit Log Baseline Evidence (2026-02-28)

## Scope

Backlog item: `EXE-X-002`  
Title: Audit log baseline for CRUD + bulk operations  
Acceptance: actor/action/resource/timestamp captured consistently

## Implementation Summary

- Added audit log storage baseline (`audit_logs`) and schema mapping:
  - `packages/db/prisma/schema.prisma`
  - `packages/db/prisma/migrations/20260228103000_audit_log_baseline/migration.sql`
- Added audit module with list endpoint:
  - `apps/api/src/audit/audit.module.ts`
  - `apps/api/src/audit/audit.service.ts`
  - `apps/api/src/audit/audit.controller.ts`
- Added global interceptor for write operations:
  - `apps/api/src/common/audit/audit-log.interceptor.ts`
- Wired module/interceptor in app:
  - `apps/api/src/app.module.ts`

Behavior:
- Every non-read API request (`POST/PATCH/DELETE`) records audit row with:
  - `actorId` (from `x-pim-actor`, fallback `system`)
  - `actorRole` (from RBAC guard context)
  - `action` (HTTP method)
  - `resource` (request path)
  - `createdAt` timestamp
  - optional `resourceId` + metadata (`method`, `path`, `statusCode`)

## Verification Commands

```powershell
npm run lint
npm run build
powershell -ExecutionPolicy Bypass -File tools\phase4\audit-smoke-test.ps1
powershell -ExecutionPolicy Bypass -File tools\phase4\smoke-test.ps1
```

## Key Results

- Full workspace lint: pass
- Full workspace build: pass
- Audit smoke:

```json
{"actor":"audit-smoke","categoryId":"cmm5uwl7s0001ux3sorwcfqny","productId":"cmm5uwl8a0003ux3san6tyzp4","bulkEditOperationId":"cmm5uwl9v0006ux3seqbb4shh","auditRecordsFetched":3,"categoryAuditAction":"POST","productAuditAction":"POST","bulkAuditAction":"POST","checkedAt":"2026-02-28T10:34:22"}
```

- Phase 4 regression smoke:

```json
{"goodJobId":"cmm5uwtyb0003uxhgt721pu37","goodJobStatus":"completed","goodSuccessRows":2,"mappingTitle":"product_name","bulkEditPreview":2,"bulkEditApplyId":"cmm5uwu41000auxhgpa8gcc1g","bulkEditApplied":2,"badJobId":"cmm5uwu66000guxhgsg0yo0mx","badFirstStatus":"retrying","badSecondStatus":"dead_letter","repairedRow":"cmm5uwu68000huxhgnf19td4x","repairedStatus":"success","badJobAfterFix":"completed","requeuedStatus":"completed","requeuedDlqRows":0,"checkedAt":"2026-02-28T10:34:33"}
```

## Conclusion

`EXE-X-002` acceptance is satisfied: audit logs consistently capture actor/action/resource/timestamp for CRUD and bulk write operations, with successful validation and no regression in core workflows.
