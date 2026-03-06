CREATE TABLE IF NOT EXISTS connector_mapping_versions (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  connector_slug TEXT NOT NULL,
  category_scope TEXT NOT NULL,
  mapping_level TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  connector_definition_id TEXT NOT NULL,
  connector_definition_version TEXT NOT NULL,
  compatibility_state TEXT NOT NULL DEFAULT 'compatible',
  mapping_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  fallback_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  fallback_ack_required BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NULL,
  superseded_by TEXT NULL REFERENCES connector_mapping_versions(id),
  created_by TEXT NULL,
  archived_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connector_mapping_versions_mapping_level_check CHECK (
    mapping_level IN ('connector_default_template', 'tenant_connector_default', 'tenant_connector_category_mapping')
  ),
  CONSTRAINT connector_mapping_versions_lifecycle_state_check CHECK (
    lifecycle_state IN ('draft', 'validated', 'published', 'superseded', 'archived')
  ),
  CONSTRAINT connector_mapping_versions_compatibility_state_check CHECK (
    compatibility_state IN ('compatible', 'deprecated', 'remap_required', 'blocked')
  ),
  CONSTRAINT connector_mapping_versions_scope_check CHECK (
    (mapping_level = 'connector_default_template' AND category_scope = '*')
    OR (mapping_level = 'tenant_connector_default' AND category_scope = '*')
    OR (mapping_level = 'tenant_connector_category_mapping' AND category_scope <> '*')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_mapping_versions_one_published
ON connector_mapping_versions(tenant_key, connector_slug, category_scope)
WHERE lifecycle_state = 'published';

CREATE INDEX IF NOT EXISTS idx_connector_mapping_versions_lookup
ON connector_mapping_versions(tenant_key, connector_slug, category_scope, lifecycle_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_mapping_versions_compat
ON connector_mapping_versions(tenant_key, connector_slug, compatibility_state, lifecycle_state, created_at DESC);

CREATE TABLE IF NOT EXISTS connector_mapping_events (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  mapping_version_id TEXT NOT NULL REFERENCES connector_mapping_versions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connector_mapping_events_event_type_check CHECK (
    event_type IN ('created', 'validated', 'published', 'superseded', 'archived', 'resolution_evaluated')
  )
);

CREATE INDEX IF NOT EXISTS idx_connector_mapping_events_lookup
ON connector_mapping_events(tenant_key, mapping_version_id, created_at DESC);

ALTER TABLE connector_mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_mapping_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_mapping_versions'
      AND policyname = 'connector_mapping_versions_tenant_isolation'
  ) THEN
    CREATE POLICY connector_mapping_versions_tenant_isolation ON connector_mapping_versions
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_mapping_events'
      AND policyname = 'connector_mapping_events_tenant_isolation'
  ) THEN
    CREATE POLICY connector_mapping_events_tenant_isolation ON connector_mapping_events
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;
