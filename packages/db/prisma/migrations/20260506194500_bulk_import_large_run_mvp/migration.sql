-- CreateEnum
CREATE TYPE "BulkImportRunStatus" AS ENUM (
    'uploaded',
    'validating',
    'preflight_blocked',
    'preflight_ready',
    'queued',
    'processing',
    'repair_required',
    'completed',
    'failed'
);

-- CreateEnum
CREATE TYPE "BulkImportRunMode" AS ENUM ('standard', 'large');

-- CreateEnum
CREATE TYPE "BulkImportJobRole" AS ENUM ('standard', 'large_batch');

-- CreateTable
CREATE TABLE "BulkImportRun" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL DEFAULT 'default',
    "categoryId" TEXT NOT NULL,
    "status" "BulkImportRunStatus" NOT NULL DEFAULT 'uploaded',
    "sourceFileKey" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceFormat" TEXT NOT NULL,
    "sourceFileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "sourceExpiresAt" TIMESTAMP(3),
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "acceptedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "deadLetterRows" INTEGER NOT NULL DEFAULT 0,
    "blockingIssueCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedBatchCount" INTEGER NOT NULL DEFAULT 0,
    "effectiveMode" "BulkImportRunMode",
    "preflightSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkImportRun_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "BulkImportJob"
ADD COLUMN "runId" TEXT,
ADD COLUMN "batchIndex" INTEGER,
ADD COLUMN "rowStart" INTEGER,
ADD COLUMN "rowEnd" INTEGER,
ADD COLUMN "jobRole" "BulkImportJobRole" NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "BulkImportRow"
ADD COLUMN "runId" TEXT,
ADD COLUMN "rowNumberGlobal" INTEGER,
ADD COLUMN "rowNumberInBatch" INTEGER;

-- CreateIndex
CREATE INDEX "BulkImportRun_tenantKey_status_createdAt_idx" ON "BulkImportRun"("tenantKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BulkImportRun_tenantKey_categoryId_createdAt_idx" ON "BulkImportRun"("tenantKey", "categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "BulkImportJob_tenantKey_runId_status_idx" ON "BulkImportJob"("tenantKey", "runId", "status");

-- CreateIndex
CREATE INDEX "BulkImportRow_tenantKey_runId_status_idx" ON "BulkImportRow"("tenantKey", "runId", "status");

-- AddForeignKey
ALTER TABLE "BulkImportRun"
ADD CONSTRAINT "BulkImportRun_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImportJob"
ADD CONSTRAINT "BulkImportJob_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "BulkImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkImportRow"
ADD CONSTRAINT "BulkImportRow_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "BulkImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
