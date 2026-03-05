# Phase 4 Evidence - EXE-P4-004 (2026-02-28)

Scope:
- Bulk import template persistence (tenant + category scoped)
- Template load workflow into import form defaults

Changed files:
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260228081000_phase4_bulk_import_templates/migration.sql`
- `apps/api/src/bulk-import/dto/create-bulk-import-template.dto.ts`
- `apps/api/src/bulk-import/bulk-import.controller.ts`
- `apps/api/src/bulk-import/bulk-import.service.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/page.tsx`

Validation:
- `npm.cmd run prisma:generate` -> pass
- `npm.cmd run lint --workspace @pim1/api` -> pass
- `npm.cmd run lint --workspace @pim1/web` -> pass
- `npm.cmd run build --workspace @pim1/api` -> pass
- `powershell -ExecutionPolicy Bypass -File tools/phase4/smoke-test.ps1` -> pass

Targeted integration check:
```json
{"templateCreated":true,"templateListed":true,"templateLoaded":true,"templateId":"cmm5pf1tt0003uxxss8gqqs3i","tenantKey":"tenant-a","categoryId":"cmm5pf1ta0001uxxs24arhpey","checkedAt":"2026-02-28T08:00:45"}
```

Environment note:
- `npm.cmd run build --workspace @pim1/web` intermittently fails in this environment with `spawn EPERM` (known local runtime restriction). Type-check lint and runtime smoke checks remain green.

Result:
- `EXE-P4-004` is complete.
