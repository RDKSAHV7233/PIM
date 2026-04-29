ALTER TABLE "Product"
ADD COLUMN IF NOT EXISTS "vendor_scope_key" TEXT;

CREATE INDEX IF NOT EXISTS "idx_product_vendor_scope_key" ON "Product"("vendor_scope_key");
CREATE INDEX IF NOT EXISTS "idx_product_tenant_vendor_scope_key" ON "Product"("tenantKey", "vendor_scope_key");
