ALTER TABLE "AuthRecoveryToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthRecoveryToken" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AuthRecoveryToken'
      AND policyname = 'tenant_isolation_auth_recovery_token'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_auth_recovery_token
      ON "AuthRecoveryToken"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
