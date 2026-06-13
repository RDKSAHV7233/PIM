-- Restore the tenant commercial default plan to STARTER for newly provisioned workspaces.
ALTER TABLE "TenantPlanProfile"
  ALTER COLUMN "planTier" SET DEFAULT 'STARTER';
