ALTER TABLE "tenant_commercial_requests"
  ADD COLUMN "requested_plan_tier" TEXT,
  ADD COLUMN "usage_snapshot" JSONB;
