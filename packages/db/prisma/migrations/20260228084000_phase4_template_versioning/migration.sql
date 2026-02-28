-- AlterTable
ALTER TABLE "BulkImportTemplate"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "schemaSnapshot" JSONB;

-- DropIndex
DROP INDEX IF EXISTS "BulkImportTemplate_tenantKey_categoryId_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "BulkImportTemplate_tenantKey_categoryId_name_version_key"
ON "BulkImportTemplate"("tenantKey", "categoryId", "name", "version");

-- CreateIndex
CREATE INDEX "BulkImportTemplate_tenantKey_categoryId_name_version_idx"
ON "BulkImportTemplate"("tenantKey", "categoryId", "name", "version");
