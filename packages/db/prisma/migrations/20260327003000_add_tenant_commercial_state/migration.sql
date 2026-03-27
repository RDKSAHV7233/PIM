ALTER TABLE "TenantPlanProfile"
  ADD COLUMN IF NOT EXISTS "billingStatus" TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS "accessStatus" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "paidThroughAt" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "graceEndsAt" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "suspensionReason" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "billingProvider" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "externalCustomerId" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "externalSubscriptionId" TEXT NULL;

UPDATE "TenantPlanProfile"
SET "billingStatus" = CASE
  WHEN UPPER(COALESCE("planTier", 'STARTER')) IN ('GROWTH', 'ENTERPRISE') THEN 'active_paid'
  ELSE 'trial'
END
WHERE "billingStatus" IS NULL
   OR BTRIM("billingStatus") = '';

UPDATE "TenantPlanProfile"
SET "accessStatus" = 'active'
WHERE "accessStatus" IS NULL
   OR BTRIM("accessStatus") = '';

CREATE INDEX IF NOT EXISTS "TenantPlanProfile_tenantKey_billingStatus_accessStatus_idx"
  ON "TenantPlanProfile"("tenantKey", "billingStatus", "accessStatus");
