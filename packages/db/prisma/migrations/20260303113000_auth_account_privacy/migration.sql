-- Auth account privacy + DPDP workflow persistence
-- Adds durable tables for consent, export requests, and account deletion requests.

CREATE TABLE IF NOT EXISTS account_consent_events (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  user_id TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  policy_version TEXT NOT NULL DEFAULT 'dpdp-v1',
  purpose TEXT NOT NULL DEFAULT 'account_access',
  consent_recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_consent_events_tenant_user_created
  ON account_consent_events (tenant_key, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_export_requests (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estimated_ready_in_seconds INT NOT NULL DEFAULT 120,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_export_requests_tenant_user_requested
  ON account_export_requests (tenant_key, user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  reason TEXT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_tenant_user_requested
  ON account_deletion_requests (tenant_key, user_id, requested_at DESC);

ALTER TABLE account_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE account_consent_events FORCE ROW LEVEL SECURITY;
ALTER TABLE account_export_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_requests FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_consent_events'
      AND policyname = 'tenant_isolation_account_consent_events'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_account_consent_events
      ON account_consent_events
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_export_requests'
      AND policyname = 'tenant_isolation_account_export_requests'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_account_export_requests
      ON account_export_requests
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_deletion_requests'
      AND policyname = 'tenant_isolation_account_deletion_requests'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_account_deletion_requests
      ON account_deletion_requests
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;
