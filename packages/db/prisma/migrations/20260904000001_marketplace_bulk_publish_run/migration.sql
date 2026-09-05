-- Bulk-Publish Goes Async, Story 2. Mirrors BulkImportRun / BulkEditOperationItem's
-- run+item split — see schema.prisma's comments on these two models for why a parent
-- run record alone can't back resumability or per-product retry.

-- CreateEnum
CREATE TYPE "MarketplaceBulkPublishRunStatus" AS ENUM ('queued', 'processing', 'completed', 'completed_with_errors', 'failed');

-- CreateEnum
CREATE TYPE "MarketplaceBulkPublishItemStatus" AS ENUM ('pending', 'queued', 'succeeded', 'failed', 'excluded');

-- CreateTable
CREATE TABLE "MarketplaceBulkPublishRun" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL DEFAULT 'default',
    "installationId" TEXT NOT NULL,
    "connectorSlug" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "requestedCount" INTEGER NOT NULL DEFAULT 0,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "MarketplaceBulkPublishRunStatus" NOT NULL DEFAULT 'queued',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceBulkPublishRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceBulkPublishRunItem" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL DEFAULT 'default',
    "runId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "MarketplaceBulkPublishItemStatus" NOT NULL DEFAULT 'pending',
    "exportJobId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "retryEligible" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceBulkPublishRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceBulkPublishRun_tenantKey_status_createdAt_idx" ON "MarketplaceBulkPublishRun"("tenantKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceBulkPublishRun_tenantKey_installationId_idx" ON "MarketplaceBulkPublishRun"("tenantKey", "installationId");

-- CreateIndex
CREATE INDEX "MarketplaceBulkPublishRunItem_runId_status_idx" ON "MarketplaceBulkPublishRunItem"("runId", "status");

-- CreateIndex
CREATE INDEX "MarketplaceBulkPublishRunItem_tenantKey_idx" ON "MarketplaceBulkPublishRunItem"("tenantKey");

-- CreateIndex
CREATE INDEX "MarketplaceBulkPublishRunItem_productId_idx" ON "MarketplaceBulkPublishRunItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceBulkPublishRunItem_runId_productId_key" ON "MarketplaceBulkPublishRunItem"("runId", "productId");

-- AddForeignKey
ALTER TABLE "MarketplaceBulkPublishRunItem" ADD CONSTRAINT "MarketplaceBulkPublishRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MarketplaceBulkPublishRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceBulkPublishRunItem" ADD CONSTRAINT "MarketplaceBulkPublishRunItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
