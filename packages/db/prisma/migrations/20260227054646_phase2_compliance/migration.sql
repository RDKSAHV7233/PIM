-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('text', 'number', 'boolean', 'select', 'json');

-- CreateEnum
CREATE TYPE "AppliesTo" AS ENUM ('product', 'variant');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('error', 'warning');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('required_field', 'regex_field', 'value_in_set');

-- CreateEnum
CREATE TYPE "ValidationIssueStatus" AS ENUM ('open', 'resolved');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "gstRate" DOUBLE PRECISION,
ADD COLUMN     "hsnCode" TEXT;

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" "AttributeDataType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "allowedValues" JSONB,
    "appliesTo" "AppliesTo" NOT NULL DEFAULT 'product',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "severity" "RuleSeverity" NOT NULL DEFAULT 'error',
    "ruleType" "RuleType" NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationIssue" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "ruleId" TEXT,
    "severity" "RuleSeverity" NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "fieldPath" TEXT,
    "status" "ValidationIssueStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttributeDefinition_categoryId_idx" ON "AttributeDefinition"("categoryId");

-- CreateIndex
CREATE INDEX "AttributeDefinition_appliesTo_idx" ON "AttributeDefinition"("appliesTo");

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDefinition_categoryId_key_appliesTo_key" ON "AttributeDefinition"("categoryId", "key", "appliesTo");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceRule_ruleCode_key" ON "ComplianceRule"("ruleCode");

-- CreateIndex
CREATE INDEX "ComplianceRule_categoryId_active_idx" ON "ComplianceRule"("categoryId", "active");

-- CreateIndex
CREATE INDEX "ComplianceRule_ruleType_idx" ON "ComplianceRule"("ruleType");

-- CreateIndex
CREATE INDEX "ValidationIssue_productId_idx" ON "ValidationIssue"("productId");

-- CreateIndex
CREATE INDEX "ValidationIssue_variantId_idx" ON "ValidationIssue"("variantId");

-- CreateIndex
CREATE INDEX "ValidationIssue_status_idx" ON "ValidationIssue"("status");

-- CreateIndex
CREATE INDEX "ValidationIssue_ruleCode_idx" ON "ValidationIssue"("ruleCode");

-- CreateIndex
CREATE INDEX "Product_hsnCode_idx" ON "Product"("hsnCode");

-- AddForeignKey
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRule" ADD CONSTRAINT "ComplianceRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationIssue" ADD CONSTRAINT "ValidationIssue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationIssue" ADD CONSTRAINT "ValidationIssue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationIssue" ADD CONSTRAINT "ValidationIssue_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ComplianceRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
