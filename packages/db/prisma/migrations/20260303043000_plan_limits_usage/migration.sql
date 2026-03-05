-- Plan limits and usage tracking (F-08)
-- Keep idempotent because some local environments may already contain these tables.

CREATE TABLE IF NOT EXISTS "PlanLimits" (
  "id" TEXT NOT NULL,
  "planTier" TEXT NOT NULL,
  "maxSkus" INTEGER NOT NULL,
  "maxSubmissionsPerMonth" INTEGER NOT NULL,
  "maxUsers" INTEGER NOT NULL,
  "maxStorageGb" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanLimits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlanLimits_planTier_key" ON "PlanLimits"("planTier");

CREATE TABLE IF NOT EXISTS "PlanUsage" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT 'default',
  "month" TEXT NOT NULL,
  "planTier" TEXT NOT NULL DEFAULT 'STARTER',
  "skuCount" INTEGER NOT NULL DEFAULT 0,
  "submissionCount" INTEGER NOT NULL DEFAULT 0,
  "storageGb" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlanUsage_tenantKey_month_key" ON "PlanUsage"("tenantKey", "month");
CREATE INDEX IF NOT EXISTS "PlanUsage_tenantKey_month_idx" ON "PlanUsage"("tenantKey", "month");

ALTER TABLE "PlanUsage" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'PlanUsage'
      AND policyname = 'PlanUsage_tenant_isolation'
  ) THEN
    CREATE POLICY "PlanUsage_tenant_isolation"
      ON "PlanUsage"
      USING ("tenantKey" = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK ("tenantKey" = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;
