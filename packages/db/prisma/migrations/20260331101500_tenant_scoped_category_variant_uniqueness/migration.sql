DROP INDEX IF EXISTS "Category_slug_key";
DROP INDEX IF EXISTS "Variant_skuCode_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Category_tenantKey_slug_key" ON "Category"("tenantKey", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Variant_tenantKey_skuCode_key" ON "Variant"("tenantKey", "skuCode");
