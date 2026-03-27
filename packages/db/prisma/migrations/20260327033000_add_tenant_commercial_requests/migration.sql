CREATE TABLE "tenant_commercial_requests" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT 'default',
  "requestType" TEXT NOT NULL DEFAULT 'upgrade',
  "status" TEXT NOT NULL DEFAULT 'open',
  "requested_by" TEXT NOT NULL,
  "requester_role" TEXT NOT NULL,
  "current_plan_tier" TEXT NOT NULL,
  "current_billing_status" TEXT NOT NULL,
  "current_access_status" TEXT NOT NULL,
  "notes" TEXT,
  "source" TEXT NOT NULL DEFAULT 'admin_plan',
  "resolved_at" TIMESTAMP(3),
  "resolved_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_commercial_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_tenant_commercial_requests_tenant_status_created"
ON "tenant_commercial_requests"("tenantKey", "status", "created_at" DESC);

CREATE INDEX "idx_tenant_commercial_requests_tenant_type_created"
ON "tenant_commercial_requests"("tenantKey", "requestType", "created_at" DESC);

CREATE INDEX "idx_tenant_commercial_requests_requester_created"
ON "tenant_commercial_requests"("requested_by", "created_at" DESC);

ALTER TABLE "tenant_commercial_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_commercial_requests" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tenant_commercial_requests'
      AND policyname = 'tenant_isolation_tenant_commercial_requests'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_tenant_commercial_requests
      ON "tenant_commercial_requests"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
