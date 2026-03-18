CREATE TABLE IF NOT EXISTS outbound_webhook_endpoints (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  target_url TEXT NOT NULL,
  signing_secret_encrypted TEXT NOT NULL,
  signing_secret_key_version TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NULL,
  last_triggered_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  endpoint_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  request_body JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_status INTEGER NULL,
  response_body TEXT NULL,
  error_message TEXT NULL,
  attempted_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_endpoints_tenant_event_active
ON outbound_webhook_endpoints (tenant_key, event_type, is_active);

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_endpoints_tenant_created
ON outbound_webhook_endpoints (tenant_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_endpoint_created
ON outbound_webhook_deliveries (tenant_key, endpoint_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_webhook_deliveries_event_status_created
ON outbound_webhook_deliveries (tenant_key, event_type, status, created_at DESC);

ALTER TABLE outbound_webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_webhook_endpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE outbound_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_webhook_deliveries FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'outbound_webhook_endpoints'
      AND policyname = 'tenant_isolation_outbound_webhook_endpoints'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_outbound_webhook_endpoints ON outbound_webhook_endpoints
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'outbound_webhook_deliveries'
      AND policyname = 'tenant_isolation_outbound_webhook_deliveries'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_outbound_webhook_deliveries ON outbound_webhook_deliveries
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;
