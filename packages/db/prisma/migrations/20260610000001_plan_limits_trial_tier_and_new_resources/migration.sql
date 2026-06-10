-- Add TRIAL plan tier and new enforcement columns to PlanLimits.
-- All new columns use safe defaults so existing rows are not blocked.
-- TenantPlanProfile.planTier default changed from STARTER to TRIAL for new tenants.

-- 1. Add new limit columns to PlanLimits
ALTER TABLE "PlanLimits"
  ADD COLUMN IF NOT EXISTS "maxApiKeys"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxOutboundWebhooks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxImportRowsPerJob" INTEGER NOT NULL DEFAULT 30000;

-- Backfill correct values for existing tiers
UPDATE "PlanLimits" SET
  "maxApiKeys"          = 0,
  "maxOutboundWebhooks" = 0,
  "maxImportRowsPerJob" = 500
WHERE "planTier" = 'TRIAL';

UPDATE "PlanLimits" SET
  "maxApiKeys"          = 0,
  "maxOutboundWebhooks" = 0,
  "maxImportRowsPerJob" = 2000
WHERE "planTier" = 'STARTER';

UPDATE "PlanLimits" SET
  "maxApiKeys"          = 3,
  "maxOutboundWebhooks" = 3,
  "maxImportRowsPerJob" = 10000
WHERE "planTier" = 'GROWTH';

UPDATE "PlanLimits" SET
  "maxApiKeys"          = 50,
  "maxOutboundWebhooks" = 50,
  "maxImportRowsPerJob" = 30000
WHERE "planTier" = 'ENTERPRISE';

-- 2. Insert TRIAL tier row if it does not yet exist (seed ensures it too, but migration is idempotent)
INSERT INTO "PlanLimits"
  ("id", "planTier", "maxSkus", "maxSubmissionsPerMonth", "maxUsers", "maxStorageGb",
   "maxConnectorInstallations", "maxAccountsPerConnector",
   "maxApiKeys", "maxOutboundWebhooks", "maxImportRowsPerJob",
   "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'TRIAL', 100, 100, 2, 1, 1, 1, 0, 0, 500, NOW(), NOW())
ON CONFLICT ("planTier") DO NOTHING;

-- 3. Update GROWTH and ENTERPRISE SKU caps to match commercial decision
UPDATE "PlanLimits" SET "maxSkus" = 10000,  "maxSubmissionsPerMonth" = 10000  WHERE "planTier" = 'GROWTH';
UPDATE "PlanLimits" SET "maxSkus" = 100000, "maxSubmissionsPerMonth" = 100000 WHERE "planTier" = 'ENTERPRISE';

-- 4. Change TenantPlanProfile default planTier from STARTER to TRIAL
ALTER TABLE "TenantPlanProfile" ALTER COLUMN "planTier" SET DEFAULT 'TRIAL';
