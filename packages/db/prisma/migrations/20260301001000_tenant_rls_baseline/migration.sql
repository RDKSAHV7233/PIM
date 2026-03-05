-- Phase 5 pre-launch hardening:
-- Add tenant key columns and enforce PostgreSQL row-level security.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'Category' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "Category" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'Product' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "Product" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'Variant' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "Variant" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'AttributeDefinition' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "AttributeDefinition" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'ComplianceRule' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "ComplianceRule" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'ValidationIssue' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "ValidationIssue" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'ChannelMappingTemplate' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "ChannelMappingTemplate" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'MarketplaceExportJob' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "MarketplaceExportJob" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'BulkImportJob' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "BulkImportJob" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'BulkImportRow' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "BulkImportRow" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'BulkEditOperation' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "BulkEditOperation" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'BulkEditOperationItem' AND column_name = 'tenantKey'
  ) THEN
    ALTER TABLE "BulkEditOperationItem" ADD COLUMN "tenantKey" TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'tenant_key'
  ) THEN
    NULL;
  ELSE
    ALTER TABLE audit_logs ADD COLUMN tenant_key TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name = 'media_assets' AND column_name = 'tenant_key'
    ) THEN
      ALTER TABLE media_assets ADD COLUMN tenant_key TEXT;
    END IF;
  END IF;
END $$;

-- Backfill tenant key using graph relationships.
UPDATE "Category" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;
UPDATE "Product" p
SET "tenantKey" = COALESCE(c."tenantKey", 'default')
FROM "Category" c
WHERE p."categoryId" = c.id
  AND p."tenantKey" IS NULL;
UPDATE "Product" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "Variant" v
SET "tenantKey" = COALESCE(p."tenantKey", 'default')
FROM "Product" p
WHERE v."productId" = p.id
  AND v."tenantKey" IS NULL;
UPDATE "Variant" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "AttributeDefinition" a
SET "tenantKey" = COALESCE(c."tenantKey", 'default')
FROM "Category" c
WHERE a."categoryId" = c.id
  AND a."tenantKey" IS NULL;
UPDATE "AttributeDefinition" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "ComplianceRule" r
SET "tenantKey" = COALESCE(c."tenantKey", 'default')
FROM "Category" c
WHERE r."categoryId" = c.id
  AND r."tenantKey" IS NULL;
UPDATE "ComplianceRule" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "ValidationIssue" v
SET "tenantKey" = COALESCE(p."tenantKey", 'default')
FROM "Product" p
WHERE v."productId" = p.id
  AND v."tenantKey" IS NULL;
UPDATE "ValidationIssue" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "ChannelMappingTemplate" t
SET "tenantKey" = COALESCE(c."tenantKey", 'default')
FROM "Category" c
WHERE t."categoryId" = c.id
  AND t."tenantKey" IS NULL;
UPDATE "ChannelMappingTemplate" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "MarketplaceExportJob" j
SET "tenantKey" = COALESCE(
  (SELECT p."tenantKey" FROM "Product" p WHERE p.id = j."productId"),
  (SELECT c."tenantKey" FROM "Category" c WHERE c.id = j."categoryId"),
  'default'
)
WHERE j."tenantKey" IS NULL;
UPDATE "MarketplaceExportJob" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "BulkImportJob" j
SET "tenantKey" = COALESCE(c."tenantKey", 'default')
FROM "Category" c
WHERE j."categoryId" = c.id
  AND j."tenantKey" IS NULL;
UPDATE "BulkImportJob" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "BulkImportRow" r
SET "tenantKey" = COALESCE(j."tenantKey", 'default')
FROM "BulkImportJob" j
WHERE r."jobId" = j.id
  AND r."tenantKey" IS NULL;
UPDATE "BulkImportRow" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "BulkEditOperation" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;
UPDATE "BulkEditOperationItem" i
SET "tenantKey" = COALESCE(
  (SELECT p."tenantKey" FROM "Product" p WHERE p.id = i."productId"),
  (SELECT o."tenantKey" FROM "BulkEditOperation" o WHERE o.id = i."operationId"),
  'default'
)
WHERE i."tenantKey" IS NULL;
UPDATE "BulkEditOperationItem" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL;

UPDATE "BulkImportTemplate" SET "tenantKey" = 'default' WHERE "tenantKey" IS NULL OR btrim("tenantKey") = '';

UPDATE audit_logs SET tenant_key = 'default' WHERE tenant_key IS NULL OR btrim(tenant_key) = '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets') THEN
    EXECUTE '
      UPDATE media_assets m
      SET tenant_key = COALESCE(p."tenantKey", ''default'')
      FROM "Product" p
      WHERE m.product_id = p.id
        AND (m.tenant_key IS NULL OR btrim(m.tenant_key) = '''')
    ';
    EXECUTE '
      UPDATE media_assets
      SET tenant_key = ''default''
      WHERE tenant_key IS NULL OR btrim(tenant_key) = ''''
    ';
  END IF;
END $$;

-- Default tenant key can be overridden per DB session using:
--   SET app.tenant_key = 'tenant-id';
ALTER TABLE "Category" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "Product" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "Variant" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "AttributeDefinition" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "ComplianceRule" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "ValidationIssue" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "ChannelMappingTemplate" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "MarketplaceExportJob" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "BulkImportJob" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "BulkImportRow" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "BulkEditOperation" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "BulkEditOperationItem" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE "BulkImportTemplate" ALTER COLUMN "tenantKey" SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');
ALTER TABLE audit_logs ALTER COLUMN tenant_key SET DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets') THEN
    EXECUTE 'ALTER TABLE media_assets ALTER COLUMN tenant_key SET DEFAULT COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
  END IF;
END $$;

ALTER TABLE "Category" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "Variant" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "AttributeDefinition" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "ComplianceRule" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "ValidationIssue" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "ChannelMappingTemplate" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "MarketplaceExportJob" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "BulkImportJob" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "BulkImportRow" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "BulkEditOperation" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "BulkEditOperationItem" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE "BulkImportTemplate" ALTER COLUMN "tenantKey" SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN tenant_key SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets') THEN
    EXECUTE 'ALTER TABLE media_assets ALTER COLUMN tenant_key SET NOT NULL';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_category_tenant_key" ON "Category"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_product_tenant_key" ON "Product"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_variant_tenant_key" ON "Variant"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_attribute_definition_tenant_key" ON "AttributeDefinition"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_compliance_rule_tenant_key" ON "ComplianceRule"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_validation_issue_tenant_key" ON "ValidationIssue"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_channel_mapping_template_tenant_key" ON "ChannelMappingTemplate"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_marketplace_export_job_tenant_key" ON "MarketplaceExportJob"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_bulk_import_job_tenant_key" ON "BulkImportJob"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_bulk_import_row_tenant_key" ON "BulkImportRow"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_bulk_edit_operation_tenant_key" ON "BulkEditOperation"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_bulk_edit_operation_item_tenant_key" ON "BulkEditOperationItem"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_bulk_import_template_tenant_key" ON "BulkImportTemplate"("tenantKey");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_tenant_key" ON audit_logs(tenant_key);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_media_assets_tenant_key ON media_assets(tenant_key)';
  END IF;
END $$;

ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Variant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttributeDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ValidationIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChannelMappingTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceExportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkImportRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkEditOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkEditOperationItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkImportTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets') THEN
    EXECUTE 'ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Variant" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AttributeDefinition" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ComplianceRule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ValidationIssue" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ChannelMappingTemplate" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceExportJob" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BulkImportJob" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BulkImportRow" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BulkEditOperation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BulkEditOperationItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "BulkImportTemplate" FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets') THEN
    EXECUTE 'ALTER TABLE media_assets FORCE ROW LEVEL SECURITY';
  END IF;
END $$;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Category' AND policyname = 'tenant_isolation_category') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_category ON "Category" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Product' AND policyname = 'tenant_isolation_product') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_product ON "Product" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Variant' AND policyname = 'tenant_isolation_variant') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_variant ON "Variant" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'AttributeDefinition' AND policyname = 'tenant_isolation_attribute_definition') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_attribute_definition ON "AttributeDefinition" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ComplianceRule' AND policyname = 'tenant_isolation_compliance_rule') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_compliance_rule ON "ComplianceRule" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ValidationIssue' AND policyname = 'tenant_isolation_validation_issue') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_validation_issue ON "ValidationIssue" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ChannelMappingTemplate' AND policyname = 'tenant_isolation_channel_mapping_template') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_channel_mapping_template ON "ChannelMappingTemplate" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'MarketplaceExportJob' AND policyname = 'tenant_isolation_marketplace_export_job') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_marketplace_export_job ON "MarketplaceExportJob" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'BulkImportJob' AND policyname = 'tenant_isolation_bulk_import_job') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_bulk_import_job ON "BulkImportJob" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'BulkImportRow' AND policyname = 'tenant_isolation_bulk_import_row') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_bulk_import_row ON "BulkImportRow" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'BulkEditOperation' AND policyname = 'tenant_isolation_bulk_edit_operation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_bulk_edit_operation ON "BulkEditOperation" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'BulkEditOperationItem' AND policyname = 'tenant_isolation_bulk_edit_operation_item') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_bulk_edit_operation_item ON "BulkEditOperationItem" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'BulkImportTemplate' AND policyname = 'tenant_isolation_bulk_import_template') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_bulk_import_template ON "BulkImportTemplate" USING ("tenantKey" = ' || tenant_expr || ') WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'tenant_isolation_audit_logs') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_audit_logs ON audit_logs USING (tenant_key = ' || tenant_expr || ') WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'media_assets')
     AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_assets' AND policyname = 'tenant_isolation_media_assets') THEN
    EXECUTE 'CREATE POLICY tenant_isolation_media_assets ON media_assets USING (tenant_key = ' || tenant_expr || ') WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;
END $$;
