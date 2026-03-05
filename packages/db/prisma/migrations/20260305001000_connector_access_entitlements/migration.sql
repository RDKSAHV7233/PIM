-- Connector access entitlement rollout
-- Adds explicit tenant plan source-of-truth, connector plan limits, connector usage counters,
-- and connector action permission table with tenant isolation policies.

ALTER TABLE "PlanLimits"
  ADD COLUMN IF NOT EXISTS "maxConnectorInstallations" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "maxAccountsPerConnector" INTEGER NOT NULL DEFAULT 1;

UPDATE "PlanLimits"
SET
  "maxConnectorInstallations" = CASE
    WHEN "planTier" = 'STARTER' THEN 2
    WHEN "planTier" = 'GROWTH' THEN 10
    WHEN "planTier" = 'ENTERPRISE' THEN 100
    ELSE COALESCE("maxConnectorInstallations", 2)
  END,
  "maxAccountsPerConnector" = CASE
    WHEN "planTier" = 'STARTER' THEN 1
    WHEN "planTier" = 'GROWTH' THEN 3
    WHEN "planTier" = 'ENTERPRISE' THEN 20
    ELSE COALESCE("maxAccountsPerConnector", 1)
  END,
  "updatedAt" = NOW();

ALTER TABLE "PlanUsage"
  ADD COLUMN IF NOT EXISTS "connectorInstallationsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "connectorAccountsCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "PlanUsage" pu
SET
  "connectorInstallationsCount" = src.installation_count,
  "connectorAccountsCount" = src.max_accounts_per_connector,
  "updatedAt" = NOW()
FROM (
  SELECT
    tenant_key,
    COUNT(*)::INT AS installation_count,
    COALESCE(MAX(account_count), 0)::INT AS max_accounts_per_connector
  FROM (
    SELECT
      ci.tenant_key,
      ci.connector_id,
      COUNT(*)::INT AS account_count
    FROM connector_installations ci
    GROUP BY ci.tenant_key, ci.connector_id
  ) grouped
  GROUP BY tenant_key
) src
WHERE pu."tenantKey" = src.tenant_key;

CREATE TABLE IF NOT EXISTS "TenantPlanProfile" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL,
  "planTier" TEXT NOT NULL DEFAULT 'STARTER',
  "effectiveFrom" TIMESTAMPTZ NULL,
  "updatedBy" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TenantPlanProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantPlanProfile_tenantKey_key"
  ON "TenantPlanProfile"("tenantKey");

CREATE INDEX IF NOT EXISTS "TenantPlanProfile_tenantKey_planTier_idx"
  ON "TenantPlanProfile"("tenantKey", "planTier");

INSERT INTO "TenantPlanProfile" ("id", "tenantKey", "planTier", "effectiveFrom", "createdAt", "updatedAt")
SELECT
  'tpp_' || md5(tenant_key || ':starter'),
  tenant_key,
  COALESCE(plan_tier, 'STARTER'),
  NOW(),
  NOW(),
  NOW()
FROM (
  SELECT tenant_key, MAX(plan_tier) AS plan_tier
  FROM (
    SELECT "tenantKey" AS tenant_key, MAX("planTier") AS plan_tier FROM "PlanUsage" GROUP BY "tenantKey"
    UNION ALL
    SELECT tenant_key, NULL::TEXT FROM connector_installations GROUP BY tenant_key
    UNION ALL
    SELECT "tenantKey" AS tenant_key, NULL::TEXT FROM "Product" GROUP BY "tenantKey"
    UNION ALL
    SELECT tenant_key, NULL::TEXT FROM audit_logs GROUP BY tenant_key
  ) seeds
  GROUP BY tenant_key
) seed
WHERE tenant_key IS NOT NULL
ON CONFLICT ("tenantKey") DO NOTHING;

INSERT INTO "TenantPlanProfile" ("id", "tenantKey", "planTier", "effectiveFrom", "createdAt", "updatedAt")
VALUES ('tpp_default', 'default', 'STARTER', NOW(), NOW(), NOW())
ON CONFLICT ("tenantKey") DO NOTHING;

CREATE TABLE IF NOT EXISTS "ConnectorPermission" (
  "id" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  "principalType" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "connectorSlug" TEXT NOT NULL,
  "accountAlias" TEXT NOT NULL DEFAULT '*',
  "action" TEXT NOT NULL,
  "createdBy" TEXT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ConnectorPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectorPermission_tenantKey_principalType_principalId_connectorSlug_accountAlias_action_key"
  ON "ConnectorPermission"("tenantKey", "principalType", "principalId", "connectorSlug", "accountAlias", "action");

CREATE INDEX IF NOT EXISTS "ConnectorPermission_tenantKey_principalType_principalId_idx"
  ON "ConnectorPermission"("tenantKey", "principalType", "principalId");

CREATE INDEX IF NOT EXISTS "ConnectorPermission_tenantKey_connectorSlug_action_idx"
  ON "ConnectorPermission"("tenantKey", "connectorSlug", "action");

ALTER TABLE "TenantPlanProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorPermission" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'TenantPlanProfile'
      AND policyname = 'TenantPlanProfile_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY "TenantPlanProfile_tenant_isolation" ON "TenantPlanProfile" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ConnectorPermission'
      AND policyname = 'ConnectorPermission_tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY "ConnectorPermission_tenant_isolation" ON "ConnectorPermission" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
