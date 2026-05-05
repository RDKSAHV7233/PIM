-- Enable RLS and add tenant isolation policies for MFA and auth policy tables.
-- Covers TenantAuthPolicy, user_mfa_enrollments, and user_mfa_backup_codes.

ALTER TABLE "TenantAuthPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantAuthPolicy" FORCE ROW LEVEL SECURITY;

ALTER TABLE "user_mfa_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_mfa_enrollments" FORCE ROW LEVEL SECURITY;

ALTER TABLE "user_mfa_backup_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_mfa_backup_codes" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'TenantAuthPolicy'
      AND policyname = 'tenant_isolation_tenant_auth_policy'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_tenant_auth_policy
      ON "TenantAuthPolicy"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_mfa_enrollments'
      AND policyname = 'tenant_isolation_user_mfa_enrollments'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_user_mfa_enrollments
      ON user_mfa_enrollments
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_mfa_backup_codes'
      AND policyname = 'tenant_isolation_user_mfa_backup_codes'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_user_mfa_backup_codes
      ON user_mfa_backup_codes
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
