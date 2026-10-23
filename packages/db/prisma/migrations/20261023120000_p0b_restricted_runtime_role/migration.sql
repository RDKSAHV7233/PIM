-- P0-B: Create a restricted runtime role that cannot bypass row level security.
--
-- Problem: vexa_app_v2 has SUPERUSER, which bypasses all RLS policies regardless of
-- ENABLE/FORCE ROW LEVEL SECURITY on tables. Tenant isolation exists in policy definitions
-- but is not enforced at the database boundary.
--
-- Solution: Create vexa_runtime with NOSUPERUSER + NOBYPASSRLS + LOGIN. The running
-- application connects as this role; RLS policies are enforced on every query. Migrations
-- continue to run as vexa_app_v2 (via DIRECT_URL) which retains DDL privileges as table owner.
--
-- Guard: this migration only acts when run by a superuser (production: vexa_app_v2,
-- CI: postgres). When the identity model tools have already created the roles and grants
-- (the db-identity rehearsal runs migrations as vexa_migrator after create-roles and
-- apply-grants), this migration is a safe no-op.
--
-- Post-migration steps (DBA/CTO — not automatable):
--   1. SET PASSWORD:  ALTER ROLE vexa_runtime PASSWORD '<strong-random-64-char>';
--   2. RAILWAY:       Add DIRECT_URL env var with the vexa_app_v2 connection string
--   3. RAILWAY:       Update DATABASE_URL to use vexa_runtime credentials
--   4. REDEPLOY:      Railway redeploy to pick up the new connection string
--   5. VERIFY:        Run the verification queries at the bottom of this file

DO $$
DECLARE
  _is_super BOOLEAN;
BEGIN
  SELECT rolsuper INTO _is_super FROM pg_roles WHERE rolname = current_user;

  IF NOT _is_super THEN
    RAISE NOTICE 'P0-B migration: current user % is not a superuser — skipping (identity tools handle this path)', current_user;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vexa_runtime') THEN
    CREATE ROLE vexa_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    RAISE NOTICE 'Created role vexa_runtime (grants are applied by the identity tools or the deploy pipeline)';
  ELSE
    ALTER ROLE vexa_runtime NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    RAISE NOTICE 'Role vexa_runtime already exists — attributes reset to restricted';
  END IF;
END $$;

-- ── Verification queries (run as vexa_app_v2 after deployment) ─────────────────
-- These are comments, not executed. DBA runs them manually to verify.
--
-- 1. Confirm restricted attributes:
--    SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
--    FROM pg_roles WHERE rolname = 'vexa_runtime';
--    Expected: rolsuper=f, rolbypassrls=f, rolcreatedb=f, rolcreaterole=f, rolcanlogin=t
--
-- 2. Confirm RLS is enforced (connect as vexa_runtime, no tenant context):
--    SET ROLE vexa_runtime;
--    SET app.tenant_key = '';
--    SELECT count(*) FROM "Product";
--    -- Should return 0 or only 'default' tenant rows
--
-- 3. Confirm cross-tenant read is blocked:
--    SET ROLE vexa_runtime;
--    SET app.tenant_key = 'tenant-a';
--    SELECT count(*) FROM "Product" WHERE "tenantKey" = 'tenant-b';
--    -- Should return 0
--
-- 4. Confirm cross-tenant write is blocked:
--    SET ROLE vexa_runtime;
--    SET app.tenant_key = 'tenant-a';
--    INSERT INTO "Product" ("tenantKey", ...) VALUES ('tenant-b', ...);
--    -- Should fail with RLS policy violation
--
-- 5. Confirm DDL is blocked:
--    SET ROLE vexa_runtime;
--    DROP TABLE "Product";
--    -- Should fail with permission denied
