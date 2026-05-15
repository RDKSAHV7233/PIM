-- Add nullable installation_id to marketplace_export_jobs for multi-store Shopify support.
-- Existing rows keep NULL, retaining full backward compatibility with slug-scoped resolution.
ALTER TABLE "MarketplaceExportJob"
  ADD COLUMN IF NOT EXISTS "installation_id" TEXT;

CREATE INDEX IF NOT EXISTS "MarketplaceExportJob_installation_id_idx"
  ON "MarketplaceExportJob" ("installation_id");
