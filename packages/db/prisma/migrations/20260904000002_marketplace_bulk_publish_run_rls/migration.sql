-- Bulk-Publish Goes Async, Story 2 follow-up. The previous migration
-- (20260904000001_marketplace_bulk_publish_run) created MarketplaceBulkPublishRun
-- and MarketplaceBulkPublishRunItem without enabling RLS, caught by the
-- backend-tests job's "Prisma migrate deploy + RLS verification" step
-- (scripts/verify-tenant-rls.cjs). Mirrors BulkImportRun's pattern exactly.

-- Enable RLS on MarketplaceBulkPublishRun
ALTER TABLE "MarketplaceBulkPublishRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceBulkPublishRun" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'MarketplaceBulkPublishRun' AND policyname = 'tenant_isolation_marketplace_bulk_publish_run'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_marketplace_bulk_publish_run ON "MarketplaceBulkPublishRun" USING ("tenantKey" = %s)',
      tenant_expr
    );
  END IF;
END
$$;

-- Enable RLS on MarketplaceBulkPublishRunItem
ALTER TABLE "MarketplaceBulkPublishRunItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceBulkPublishRunItem" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'MarketplaceBulkPublishRunItem' AND policyname = 'tenant_isolation_marketplace_bulk_publish_run_item'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_marketplace_bulk_publish_run_item ON "MarketplaceBulkPublishRunItem" USING ("tenantKey" = %s)',
      tenant_expr
    );
  END IF;
END
$$;
