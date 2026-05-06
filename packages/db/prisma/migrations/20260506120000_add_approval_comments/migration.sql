-- CreateTable: approval_comments
CREATE TABLE "approval_comments" (
    "id" TEXT NOT NULL,
    "tenant_key" TEXT NOT NULL DEFAULT 'default',
    "product_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_approval_comments_tenant_product_created" ON "approval_comments"("tenant_key", "product_id", "created_at" DESC);

-- Enable RLS for approval_comments
ALTER TABLE "approval_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_comments" FORCE ROW LEVEL SECURITY;

-- Create tenant isolation policy for approval_comments
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
