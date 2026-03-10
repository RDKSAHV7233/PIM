ALTER TABLE "MarketplaceExportJob"
ADD COLUMN IF NOT EXISTS "created_by" TEXT NULL;

CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT NULL,
  action_label TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_tenant_user_created
ON user_notifications (tenant_key, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_tenant_user_read_created
ON user_notifications (tenant_key, user_id, read_at, created_at DESC);

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notifications'
      AND policyname = 'tenant_isolation_user_notifications'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_user_notifications ON user_notifications
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;
