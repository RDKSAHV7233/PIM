-- Connector framework tables moved from runtime DDL to Prisma migration.
-- This keeps schema creation out of onModuleInit and makes deployments deterministic.

CREATE TABLE IF NOT EXISTS connector_definitions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  marketplace_id TEXT NULL,
  connector_version TEXT NOT NULL DEFAULT '1.0.0',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_installations (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  connector_id TEXT NOT NULL REFERENCES connector_definitions(id) ON DELETE RESTRICT,
  account_alias TEXT NOT NULL DEFAULT 'primary',
  external_account_ref TEXT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  installed_by TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connector_installations_tenant_connector_alias_unique UNIQUE (tenant_key, connector_id, account_alias)
);

CREATE TABLE IF NOT EXISTS connector_credentials (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  installation_id TEXT NOT NULL REFERENCES connector_installations(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  key_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  scope TEXT NULL,
  expires_at TIMESTAMPTZ NULL,
  last_validated_at TIMESTAMPTZ NULL,
  last_refresh_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT connector_credentials_installation_type_unique UNIQUE (installation_id, credential_type)
);

CREATE TABLE IF NOT EXISTS connector_submissions (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  installation_id TEXT NOT NULL REFERENCES connector_installations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id TEXT NULL,
  idempotency_key TEXT NOT NULL,
  submission_type TEXT NOT NULL,
  source TEXT NOT NULL,
  attempt_number INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  external_ref TEXT NULL,
  payload_snapshot JSONB NOT NULL,
  payload_snapshot_url TEXT NULL,
  channel_errors JSONB NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL
);

ALTER TABLE connector_submissions
ADD COLUMN IF NOT EXISTS payload_snapshot_url TEXT NULL;

ALTER TABLE connector_submissions
DROP CONSTRAINT IF EXISTS connector_submissions_idempotency_key_key;

DROP INDEX IF EXISTS connector_submissions_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_submissions_tenant_installation_idempotency
ON connector_submissions(tenant_key, installation_id, idempotency_key);

CREATE TABLE IF NOT EXISTS connector_webhook_events (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  installation_id TEXT NOT NULL REFERENCES connector_installations(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  submission_id TEXT NULL,
  CONSTRAINT connector_webhook_installation_event_unique UNIQUE (installation_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_installations_tenant_installed_at
ON connector_installations(tenant_key, installed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_connector_submissions_tenant_status
ON connector_submissions(tenant_key, status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_connector_webhooks_tenant_processed
ON connector_webhook_events(tenant_key, installation_id, processed_at);

ALTER TABLE connector_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_installations'
      AND policyname = 'connector_installations_tenant_isolation'
  ) THEN
    CREATE POLICY connector_installations_tenant_isolation ON connector_installations
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_credentials'
      AND policyname = 'connector_credentials_tenant_isolation'
  ) THEN
    CREATE POLICY connector_credentials_tenant_isolation ON connector_credentials
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_submissions'
      AND policyname = 'connector_submissions_tenant_isolation'
  ) THEN
    CREATE POLICY connector_submissions_tenant_isolation ON connector_submissions
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'connector_webhook_events'
      AND policyname = 'connector_webhooks_tenant_isolation'
  ) THEN
    CREATE POLICY connector_webhooks_tenant_isolation ON connector_webhook_events
      USING (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'))
      WITH CHECK (tenant_key = COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'));
  END IF;
END $$;

