-- Create approval_comments table with tenant isolation RLS policy.

CREATE TABLE IF NOT EXISTS approval_comments (
  id TEXT NOT NULL,
  tenant_key TEXT NOT NULL DEFAULT 'default',
  product_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  decision TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT approval_comments_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_approval_comments_tenant_product_created
  ON approval_comments (tenant_key, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_approval_comments_tenant_key
  ON approval_comments (tenant_key);

ALTER TABLE approval_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_comments FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'approval_comments'
      AND policyname = 'tenant_isolation_approval_comments'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_approval_comments
      ON approval_comments
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;
