-- RG-C4: Product relationships / bundles / kits
--
-- A single polymorphic ProductRelationship table covers all relationship
-- types (bundle, kit, accessory, replacement, similar) via an enum, avoiding
-- schema proliferation. The type column determines semantics; optional
-- quantityInParent supports bundle/kit component quantities.
--
-- RLS tenant isolation is applied to prevent cross-tenant relationship leakage.

-- 1. ProductRelationshipType enum
DO $$ BEGIN
  CREATE TYPE "ProductRelationshipType" AS ENUM (
    'bundle_component',
    'bundle_parent',
    'kit_component',
    'kit_parent',
    'accessory',
    'replacement',
    'similar'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. ProductRelationship table
CREATE TABLE IF NOT EXISTS "product_relationships" (
  "id"                TEXT                        NOT NULL PRIMARY KEY,
  "tenant_key"        TEXT                        NOT NULL DEFAULT 'default',
  "source_product_id" TEXT                        NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "target_product_id" TEXT                        NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "type"              "ProductRelationshipType"   NOT NULL,
  "quantity_in_parent" INTEGER,
  "sort_order"        INTEGER                     NOT NULL DEFAULT 0,
  "metadata"          JSONB                       NOT NULL DEFAULT '{}',
  "created_at"        TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

-- Unique: a source product can only have one relationship of a given type
-- to a given target product.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_relationship_source_target_type"
  ON "product_relationships" ("tenant_key", "source_product_id", "target_product_id", "type");

CREATE INDEX IF NOT EXISTS "idx_product_relationships_source"
  ON "product_relationships" ("tenant_key", "source_product_id");

CREATE INDEX IF NOT EXISTS "idx_product_relationships_target"
  ON "product_relationships" ("tenant_key", "target_product_id");

CREATE INDEX IF NOT EXISTS "idx_product_relationships_type"
  ON "product_relationships" ("tenant_key", "type");

-- 3. RLS tenant isolation
ALTER TABLE "product_relationships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_relationships" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'product_relationships'
      AND policyname = 'tenant_isolation_product_relationships'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_product_relationships ON "product_relationships"
      USING ("tenant_key" = ' || tenant_expr || ')
      WITH CHECK ("tenant_key" = ' || tenant_expr || ')';
  END IF;
END $$;
