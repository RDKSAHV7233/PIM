-- Sprint 8: ConnectorProductSyncState — tracks last-synced version per product per installation
CREATE TABLE IF NOT EXISTS "connector_product_sync_states" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "tenant_key"          TEXT NOT NULL DEFAULT 'default',
  "installation_id"     TEXT NOT NULL,
  "product_id"          TEXT NOT NULL,
  "last_synced_at"      TIMESTAMPTZ,
  "last_synced_version" INTEGER,
  "last_synced_status"  TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "connector_product_sync_state_unique" UNIQUE ("tenant_key", "installation_id", "product_id")
);
CREATE INDEX IF NOT EXISTS "idx_connector_product_sync_state_installation"
  ON "connector_product_sync_states" ("tenant_key", "installation_id", "last_synced_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_connector_product_sync_state_version"
  ON "connector_product_sync_states" ("tenant_key", "installation_id", "last_synced_version");

-- Sprint 9: ConnectorSyncSchedule — BullMQ repeatable job config per installation
CREATE TABLE IF NOT EXISTS "connector_sync_schedules" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "tenant_key"       TEXT NOT NULL DEFAULT 'default',
  "installation_id"  TEXT NOT NULL,
  "cron_expression"  TEXT NOT NULL,
  "scope"            TEXT NOT NULL DEFAULT 'approved_only',
  "status"           TEXT NOT NULL DEFAULT 'active',
  "last_run_at"      TIMESTAMPTZ,
  "next_run_at"      TIMESTAMPTZ,
  "last_run_outcome" TEXT,
  "created_by"       TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "connector_sync_schedule_unique" UNIQUE ("tenant_key", "installation_id")
);
CREATE INDEX IF NOT EXISTS "idx_connector_sync_schedule_installation_status"
  ON "connector_sync_schedules" ("tenant_key", "installation_id", "status");

-- Sprint 10: ConnectorProductLink — confirmed SKU→Shopify GID mapping for existing catalog
CREATE TABLE IF NOT EXISTS "connector_product_links" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "tenant_key"       TEXT NOT NULL DEFAULT 'default',
  "installation_id"  TEXT NOT NULL,
  "product_id"       TEXT NOT NULL,
  "shopify_gid"      TEXT NOT NULL,
  "matched_by"       TEXT NOT NULL,
  "confirmed_at"     TIMESTAMPTZ,
  "confirmed_by"     TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "connector_product_link_unique" UNIQUE ("tenant_key", "installation_id", "product_id")
);
CREATE INDEX IF NOT EXISTS "idx_connector_product_link_gid"
  ON "connector_product_links" ("tenant_key", "installation_id", "shopify_gid");

ALTER TABLE "connector_product_sync_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_product_sync_states" FORCE ROW LEVEL SECURITY;
ALTER TABLE "connector_sync_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_sync_schedules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "connector_product_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_product_links" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_product_sync_states'
      AND policyname = 'connector_product_sync_states_tenant_isolation'
  ) THEN
    CREATE POLICY connector_product_sync_states_tenant_isolation ON "connector_product_sync_states"
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_sync_schedules'
      AND policyname = 'connector_sync_schedules_tenant_isolation'
  ) THEN
    CREATE POLICY connector_sync_schedules_tenant_isolation ON "connector_sync_schedules"
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_product_links'
      AND policyname = 'connector_product_links_tenant_isolation'
  ) THEN
    CREATE POLICY connector_product_links_tenant_isolation ON "connector_product_links"
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;
