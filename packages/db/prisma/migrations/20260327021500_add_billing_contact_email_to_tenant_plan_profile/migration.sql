ALTER TABLE "TenantPlanProfile"
  ADD COLUMN IF NOT EXISTS "billingContactEmail" TEXT NULL;
