-- CreateEnum
CREATE TYPE "MarketplaceChannel" AS ENUM ('amazon', 'flipkart', 'meesho');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('queued', 'processing', 'retrying', 'completed', 'failed', 'dead_letter');

-- CreateTable
CREATE TABLE "ChannelMappingTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "channel" "MarketplaceChannel" NOT NULL,
    "requiredFields" JSONB NOT NULL,
    "fieldMap" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMappingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceExportJob" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "channel" "MarketplaceChannel" NOT NULL,
    "templateId" TEXT,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'queued',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "failureReason" TEXT,
    "dlqReason" TEXT,
    "payload" JSONB,
    "exportPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelMappingTemplate_categoryId_channel_idx" ON "ChannelMappingTemplate"("categoryId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMappingTemplate_categoryId_channel_name_key" ON "ChannelMappingTemplate"("categoryId", "channel", "name");

-- CreateIndex
CREATE INDEX "MarketplaceExportJob_productId_channel_idx" ON "MarketplaceExportJob"("productId", "channel");

-- CreateIndex
CREATE INDEX "MarketplaceExportJob_status_updatedAt_idx" ON "MarketplaceExportJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketplaceExportJob_templateId_idx" ON "MarketplaceExportJob"("templateId");

-- AddForeignKey
ALTER TABLE "ChannelMappingTemplate" ADD CONSTRAINT "ChannelMappingTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceExportJob" ADD CONSTRAINT "MarketplaceExportJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceExportJob" ADD CONSTRAINT "MarketplaceExportJob_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceExportJob" ADD CONSTRAINT "MarketplaceExportJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChannelMappingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
