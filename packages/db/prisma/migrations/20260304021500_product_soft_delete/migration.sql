ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "purgedById" TEXT NULL;

CREATE INDEX IF NOT EXISTS "Product_tenantKey_deletedAt_idx"
  ON "Product"("tenantKey", "deletedAt");
