CREATE INDEX IF NOT EXISTS "idx_product_tenant_status"
  ON "Product" ("tenantKey", "status");
