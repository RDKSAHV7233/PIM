-- P0-B: Create a restricted runtime role that cannot bypass row level security.
--
-- Problem: vexa_app_v2 has SUPERUSER, which bypasses all RLS policies regardless of
-- ENABLE/FORCE ROW LEVEL SECURITY on tables. Tenant isolation exists in policy definitions
-- but is not enforced at the database boundary.
--
-- Solution: Create vexa_app_runtime with NOSUPERUSER + NOBYPASSRLS + LOGIN. The running
-- application connects as this role; RLS policies are enforced on every query. Migrations
-- continue to run as vexa_app_v2 (via DIRECT_URL) which retains DDL privileges as table owner.
--
-- Post-migration steps (DBA/CTO — not automatable):
--   1. SET PASSWORD:  ALTER ROLE vexa_app_runtime PASSWORD '<strong-random-64-char>';
--   2. RAILWAY:       Add DIRECT_URL env var with the vexa_app_v2 connection string
--   3. RAILWAY:       Update DATABASE_URL to use vexa_app_runtime credentials
--   4. REDEPLOY:      Railway redeploy to pick up the new connection string
--   5. VERIFY:        Run the verification queries at the bottom of this file

-- ── 1. Create the restricted role ──────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vexa_app_runtime') THEN
    CREATE ROLE vexa_app_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    RAISE NOTICE 'Created role vexa_app_runtime';
  ELSE
    ALTER ROLE vexa_app_runtime NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    RAISE NOTICE 'Role vexa_app_runtime already exists — attributes reset to restricted';
  END IF;
END $$;

-- ── 2. Schema access ───────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO vexa_app_runtime;

-- ── 3. Table privileges (DML only — no DDL, no TRUNCATE) ──────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vexa_app_runtime;

-- ── 4. Sequence privileges (required for auto-increment columns) ───────────────

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vexa_app_runtime;

-- ── 5. Default privileges for future objects ───────────────────────────────────
-- When the migration user creates new tables/sequences in future migrations, the
-- runtime role automatically receives the same grants. Uses CURRENT_USER so this
-- works in both production (vexa_app_v2) and CI (postgres).

DO $$ BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vexa_app_runtime',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vexa_app_runtime',
    current_user
  );
END $$;

-- ── 6. Revoke dangerous privileges ────────────────────────────────────────────
-- Ensure the runtime role cannot modify schema, create objects, or truncate.

REVOKE CREATE ON SCHEMA public FROM vexa_app_runtime;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM vexa_app_runtime;

-- ── Verification queries (run as vexa_app_v2 after deployment) ─────────────────
-- These are comments, not executed. DBA runs them manually to verify.
--
-- 1. Confirm restricted attributes:
--    SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
--    FROM pg_roles WHERE rolname = 'vexa_app_runtime';
--    Expected: rolsuper=f, rolbypassrls=f, rolcreatedb=f, rolcreaterole=f, rolcanlogin=t
--
-- 2. Confirm RLS is enforced (connect as vexa_app_runtime, no tenant context):
--    SET ROLE vexa_app_runtime;
--    SET app.tenant_key = '';
--    SELECT count(*) FROM "Product";
--    -- Should return 0 or only 'default' tenant rows
--
-- 3. Confirm cross-tenant read is blocked:
--    SET ROLE vexa_app_runtime;
--    SET app.tenant_key = 'tenant-a';
--    SELECT count(*) FROM "Product" WHERE "tenantKey" = 'tenant-b';
--    -- Should return 0
--
-- 4. Confirm cross-tenant write is blocked:
--    SET ROLE vexa_app_runtime;
--    SET app.tenant_key = 'tenant-a';
--    INSERT INTO "Product" ("tenantKey", ...) VALUES ('tenant-b', ...);
--    -- Should fail with RLS policy violation
--
-- 5. Confirm DDL is blocked:
--    SET ROLE vexa_app_runtime;
--    DROP TABLE "Product";
--    -- Should fail with permission denied
