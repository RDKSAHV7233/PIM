-- Migration: add_tax_regime_product_tax_code
-- Adds structured multi-market tax code support alongside the existing India-specific
-- Product.hsnCode / Product.gstRate flat columns (which are kept, never dropped).
--
-- TaxRegime   — system-level registry seeded at deploy time (IN, GB, US, AE, AU).
--               Not per-tenant; one row per supported market tax regime.
-- ProductTaxCode — per-product, per-market identifier rows (one row per key type).
--               Unique on (tenantKey, productId, marketCode, key) so a product can
--               have at most one HSN_CODE entry per market.
-- TaxCodeKey  — canonical enum preventing free-form string drift across regimes.

-- CreateEnum
CREATE TYPE "TaxCodeKey" AS ENUM ('HSN_CODE', 'HS_CODE', 'COMMODITY_CODE', 'TAX_CATEGORY');

-- CreateTable
CREATE TABLE "tax_regimes" (
    "id" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_regimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tax_codes" (
    "id" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL DEFAULT 'default',
    "productId" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "key" "TaxCodeKey" NOT NULL,
    "value" TEXT NOT NULL,
    "rate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_regimes_marketCode_key" ON "tax_regimes"("marketCode");

-- CreateIndex
CREATE UNIQUE INDEX "product_tax_codes_tenantKey_productId_marketCode_key_key" ON "product_tax_codes"("tenantKey", "productId", "marketCode", "key");

-- CreateIndex
CREATE INDEX "product_tax_codes_tenantKey_idx" ON "product_tax_codes"("tenantKey");

-- CreateIndex
CREATE INDEX "product_tax_codes_productId_idx" ON "product_tax_codes"("productId");

-- CreateIndex
CREATE INDEX "product_tax_codes_tenantKey_productId_idx" ON "product_tax_codes"("tenantKey", "productId");

-- CreateIndex
CREATE INDEX "product_tax_codes_tenantKey_marketCode_idx" ON "product_tax_codes"("tenantKey", "marketCode");

-- AddForeignKey
ALTER TABLE "product_tax_codes" ADD CONSTRAINT "product_tax_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tax_codes" ADD CONSTRAINT "product_tax_codes_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "tax_regimes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
