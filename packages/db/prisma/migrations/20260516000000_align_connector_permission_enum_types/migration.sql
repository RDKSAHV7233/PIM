-- Align ConnectorPermission columns to PostgreSQL enum types.
--
-- The original hand-crafted migration (20260305001000_connector_access_entitlements)
-- created principalType and action as TEXT columns. The Prisma schema declares them
-- as enum types. After `prisma db push` on a dev DB the columns were altered to enum
-- types but those enum types were never added to the migration history, so:
--   - clean migration-only DBs (staging/prod): TEXT columns, enum types absent
--   - local dev after `prisma db push`: enum columns, but unique index may be absent
--
-- This migration closes both gaps idempotently.

-- 1. Create enum types if they do not already exist.
DO $$ BEGIN
  CREATE TYPE "ConnectorPermissionPrincipalType" AS ENUM ('user', 'role');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ConnectorPermissionAction" AS ENUM ('install', 'reconnect', 'uninstall');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Alter columns from TEXT to enum type where the column is still TEXT.
--    The USING clause performs a safe cast; the values already satisfy the enum contract.
DO $$ BEGIN
  ALTER TABLE "ConnectorPermission"
    ALTER COLUMN "principalType" TYPE "ConnectorPermissionPrincipalType"
    USING "principalType"::"ConnectorPermissionPrincipalType";
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConnectorPermission"
    ALTER COLUMN "action" TYPE "ConnectorPermissionAction"
    USING "action"::"ConnectorPermissionAction";
EXCEPTION WHEN others THEN null;
END $$;

-- 3. Ensure compound unique index exists (may be absent after schema drift).
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectorPermission_tenantKey_principalType_principalId_connectorSlug_accountAlias_action_key"
  ON "ConnectorPermission"("tenantKey", "principalType", "principalId", "connectorSlug", "accountAlias", "action");
