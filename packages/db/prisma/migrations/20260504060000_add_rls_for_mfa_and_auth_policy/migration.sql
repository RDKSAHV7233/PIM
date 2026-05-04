-- Add Row-Level Security for tables introduced by the MFA foundation and auth policy migrations.
-- These tables were created without RLS; this migration backfills the policies required by
-- verify-tenant-rls.cjs so every table with a tenantKey column is isolated per tenant.

-- TenantAuthPolicy ---------------------------------------------------------------
ALTER TABLE "TenantAuthPolicy" ENABLE ROW LEVEL SECURITY;

DO $
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'TenantAuthPolicy'
      AND policyname = 'TenantAuthPolicy_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY "TenantAuthPolicy_tenant_isolation" ON "TenantAuthPolicy"'
      || ' USING ("tenantKey" = ' || tenant_expr || ')'
      || ' WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $;

-- user_mfa_enrollments -----------------------------------------------------------
ALTER TABLE "user_mfa_enrollments" ENABLE ROW LEVEL SECURITY;

DO $
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_mfa_enrollments'
      AND policyname = 'user_mfa_enrollments_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY "user_mfa_enrollments_tenant_isolation" ON "user_mfa_enrollments"'
      || ' USING ("tenantKey" = ' || tenant_expr || ')'
      || ' WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $;

-- user_mfa_backup_codes ----------------------------------------------------------
ALTER TABLE "user_mfa_backup_codes" ENABLE ROW LEVEL SECURITY;

DO $
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_mfa_backup_codes'
      AND policyname = 'user_mfa_backup_codes_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY "user_mfa_backup_codes_tenant_isolation" ON "user_mfa_backup_codes"'
      || ' USING ("tenantKey" = ' || tenant_expr || ')'
      || ' WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $;
