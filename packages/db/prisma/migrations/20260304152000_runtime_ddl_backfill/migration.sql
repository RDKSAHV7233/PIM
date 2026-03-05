-- Backfill runtime-created tables/indexes/policies into migration-owned SQL.
-- This removes startup DDL dependencies from services.

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_at
  ON audit_logs (tenant_key, created_at DESC);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  product_id TEXT NULL REFERENCES "Product"(id) ON DELETE SET NULL,
  variant_id TEXT NULL REFERENCES "Variant"(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL DEFAULT 'product',
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  width INTEGER NULL,
  height INTEGER NULL,
  size_bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS tenant_key TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS product_id TEXT NULL REFERENCES "Product"(id) ON DELETE SET NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS variant_id TEXT NULL REFERENCES "Variant"(id) ON DELETE SET NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'product';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS width INTEGER NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS height INTEGER NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS size_bytes INTEGER;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS checksum TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE media_assets
SET tenant_key = COALESCE(NULLIF(tenant_key, ''), 'default')
WHERE tenant_key IS NULL OR btrim(tenant_key) = '';

ALTER TABLE media_assets
  ALTER COLUMN tenant_key SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE media_assets
  ALTER COLUMN tenant_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_product_created_at
  ON media_assets (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_variant_created_at
  ON media_assets (variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_created_at
  ON media_assets (tenant_key, created_at DESC);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'media_assets'
      AND policyname = 'tenant_isolation_media_assets'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_media_assets
      ON media_assets
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ondc_mappings (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES "Category"(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  version TEXT NOT NULL,
  required_fields JSONB NOT NULL,
  field_map JSONB NOT NULL,
  discovery_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ondc_mappings ADD COLUMN IF NOT EXISTS tenant_key TEXT;
UPDATE ondc_mappings
SET tenant_key = COALESCE(NULLIF(tenant_key, ''), 'default')
WHERE tenant_key IS NULL OR btrim(tenant_key) = '';
ALTER TABLE ondc_mappings
  ALTER COLUMN tenant_key SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE ondc_mappings
  ALTER COLUMN tenant_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ondc_mappings_lookup
  ON ondc_mappings (node_type, version, category_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ondc_mappings_tenant_lookup
  ON ondc_mappings (tenant_key, node_type, version, category_id, updated_at DESC);

ALTER TABLE ondc_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ondc_mappings FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ondc_mappings'
      AND policyname = 'tenant_isolation_ondc_mappings'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_ondc_mappings
      ON ondc_mappings
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_skus INT NOT NULL,
  complete_skus INT NOT NULL,
  incomplete_skus INT NOT NULL,
  publish_ready_by_connector JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocked_by_connector JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejection_risk_high INT NOT NULL DEFAULT 0,
  open_issues_blocking INT NOT NULL DEFAULT 0,
  open_issues_warning INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_tenant_captured_at
  ON dashboard_snapshots (tenant_key, captured_at DESC);

ALTER TABLE dashboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_snapshots FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'dashboard_snapshots'
      AND policyname = 'tenant_isolation_dashboard_snapshots'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_dashboard_snapshots
      ON dashboard_snapshots
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kpi_metric_events (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL,
  connector_slug TEXT,
  metric_key TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  unit TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_metric_events_tenant_metric_time
  ON kpi_metric_events (tenant_key, metric_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_metric_events_tenant_connector_time
  ON kpi_metric_events (tenant_key, connector_slug, observed_at DESC);

ALTER TABLE kpi_metric_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_metric_events FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'kpi_metric_events'
      AND policyname = 'tenant_isolation_kpi_metric_events'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_kpi_metric_events
      ON kpi_metric_events
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;
