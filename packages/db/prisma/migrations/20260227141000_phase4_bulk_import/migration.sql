-- CreateEnum
CREATE TYPE "BulkImportJobStatus" AS ENUM ('queued', 'processing', 'retrying', 'completed', 'failed', 'dead_letter');

-- CreateEnum
CREATE TYPE "BulkImportRowStatus" AS ENUM ('queued', 'processing', 'success', 'retrying', 'failed', 'dead_letter');

-- CreateTable
CREATE TABLE "BulkImportJob" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "sourceName" TEXT,
    "mapping" JSONB NOT NULL,
    "chunkSize" INTEGER NOT NULL DEFAULT 100,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "status" "BulkImportJobStatus" NOT NULL DEFAULT 'queued',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "deadLetterRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkImportRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "BulkImportRowStatus" NOT NULL DEFAULT 'queued',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "productId" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkImportJob_categoryId_idx" ON "BulkImportJob"("categoryId");

-- CreateIndex
CREATE INDEX "BulkImportJob_status_updatedAt_idx" ON "BulkImportJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "BulkImportRow_jobId_status_rowNumber_idx" ON "BulkImportRow"("jobId", "status", "rowNumber");

-- CreateIndex
CREATE INDEX "BulkImportRow_productId_idx" ON "BulkImportRow"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "BulkImportRow_jobId_rowNumber_key" ON "BulkImportRow"("jobId", "rowNumber");

-- AddForeignKey
ALTER TABLE "BulkImportJob" ADD CONSTRAINT "BulkImportJob_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImportRow" ADD CONSTRAINT "BulkImportRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BulkImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImportRow" ADD CONSTRAINT "BulkImportRow_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
