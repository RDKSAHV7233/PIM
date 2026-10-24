-- P1 RLS closure: add tenant isolation policies for AuthIdentity and api_access_keys.
--
-- Both tables have tenantKey columns and are covered by the Prisma tenant-scope
-- extension (application-level isolation), but were missing database-level RLS
-- policies. This migration closes the defense-in-depth gap identified in the
-- P1 security re-verification (docs/qa/P1_SECURITY_RE_VERIFICATION_2026_10_24.md).
--
-- AuthIdentity stores passwordHash and user roles.
-- api_access_keys stores secretHash and API key scopes.

ALTER TABLE "AuthIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthIdentity" FORCE ROW LEVEL SECURITY;

ALTER TABLE "api_access_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_access_keys" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'AuthIdentity'
      AND policyname = 'tenant_isolation_auth_identity'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_auth_identity
      ON "AuthIdentity"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'api_access_keys'
      AND policyname = 'tenant_isolation_api_access_keys'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_api_access_keys
      ON api_access_keys
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
