CREATE INDEX IF NOT EXISTS "idx_product_tenant_deleted_updated_id"
  ON "Product"("tenantKey", "deletedAt", "updatedAt" DESC, "id" DESC);
