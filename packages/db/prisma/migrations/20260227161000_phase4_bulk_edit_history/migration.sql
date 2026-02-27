-- CreateEnum
CREATE TYPE "BulkEditOperationStatus" AS ENUM ('processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "BulkEditItemStatus" AS ENUM ('success', 'failed');

-- CreateTable
CREATE TABLE "BulkEditOperation" (
    "id" TEXT NOT NULL,
    "status" "BulkEditOperationStatus" NOT NULL DEFAULT 'processing',
    "scope" JSONB NOT NULL,
    "updates" JSONB NOT NULL,
    "requestedCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkEditOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkEditOperationItem" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "productId" TEXT,
    "status" "BulkEditItemStatus" NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkEditOperationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulkEditOperation_status_updatedAt_idx" ON "BulkEditOperation"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "BulkEditOperationItem_operationId_status_idx" ON "BulkEditOperationItem"("operationId", "status");

-- CreateIndex
CREATE INDEX "BulkEditOperationItem_productId_idx" ON "BulkEditOperationItem"("productId");

-- AddForeignKey
ALTER TABLE "BulkEditOperationItem" ADD CONSTRAINT "BulkEditOperationItem_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "BulkEditOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulkEditOperationItem" ADD CONSTRAINT "BulkEditOperationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
