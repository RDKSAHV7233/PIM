# Tenant Isolation Baseline (2026-03-01)

## Scope
This change establishes DB-level tenant isolation baseline before pilot onboarding:
- tenant keys added to core tables.
- PostgreSQL RLS enabled and forced.
- per-session tenant context supported through `app.tenant_key`.
- smoke scripts forced to `smoke-tenant`.

## What changed
1. Migration added:
   - `packages/db/prisma/migrations/20260301001000_tenant_rls_baseline/migration.sql`
2. Prisma schema updated with `tenantKey` fields and indexes for tenant-scoped models.
3. Smoke tenant helper:
   - `tools/dev/smoke-tenant.ps1`
4. Smoke scripts now call `Set-SmokeTenantDatabaseUrl` before API startup.
5. Verification script:
   - `tools/dev/verify-tenant-rls.cjs`

## Verification commands
1. Apply migration:
   - `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`
2. Verify RLS behavior:
   - `node tools/dev/verify-tenant-rls.cjs`
3. Run smoke in isolated tenant:
   - `powershell -ExecutionPolicy Bypass -File tools/phase4/smoke-test.ps1`

## Notes
- Existing app flows continue to run in tenant `default` unless database connection sets `app.tenant_key`.
- Smoke scripts now set tenant context at DB connection level to avoid polluting seller-visible default tenant data.
- This baseline does not introduce end-user multi-tenant routing in HTTP headers yet; it enforces DB partitioning and smoke segregation first.
