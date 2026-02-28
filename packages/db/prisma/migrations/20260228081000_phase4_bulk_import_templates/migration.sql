-- CreateTable
CREATE TABLE "BulkImportTemplate" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "chunkSize" INTEGER NOT NULL DEFAULT 100,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkImportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BulkImportTemplate_tenantKey_categoryId_name_key" ON "BulkImportTemplate"("tenantKey", "categoryId", "name");

-- CreateIndex
CREATE INDEX "BulkImportTemplate_tenantKey_categoryId_updatedAt_idx" ON "BulkImportTemplate"("tenantKey", "categoryId", "updatedAt");

-- AddForeignKey
ALTER TABLE "BulkImportTemplate" ADD CONSTRAINT "BulkImportTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
