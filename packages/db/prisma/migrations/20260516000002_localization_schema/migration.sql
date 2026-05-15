-- INC-36: Localization schema (RG-C3)
-- Adds Market, Currency, PriceList, ProductPrice, ProductTranslation, CategoryTranslation

CREATE TYPE "MarketStatus" AS ENUM ('active', 'inactive');

CREATE TABLE "Market" (
    "id"          TEXT NOT NULL,
    "tenantKey"   TEXT NOT NULL DEFAULT 'default',
    "code"        TEXT NOT NULL,
    "locale"      TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isDefault"   BOOLEAN NOT NULL DEFAULT false,
    "status"      "MarketStatus" NOT NULL DEFAULT 'active',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Currency" (
    "id"            TEXT NOT NULL,
    "tenantKey"     TEXT NOT NULL DEFAULT 'default',
    "code"          TEXT NOT NULL,
    "symbol"        TEXT NOT NULL,
    "displayName"   TEXT NOT NULL,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceList" (
    "id"         TEXT NOT NULL,
    "tenantKey"  TEXT NOT NULL DEFAULT 'default',
    "name"       TEXT NOT NULL,
    "marketId"   TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "isDefault"  BOOLEAN NOT NULL DEFAULT false,
    "status"     "MarketStatus" NOT NULL DEFAULT 'active',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPrice" (
    "id"           TEXT NOT NULL,
    "tenantKey"    TEXT NOT NULL DEFAULT 'default',
    "priceListId"  TEXT NOT NULL,
    "variantId"    TEXT NOT NULL,
    "mrp"          DOUBLE PRECISION,
    "sellingPrice" DOUBLE PRECISION,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductTranslation" (
    "id"          TEXT NOT NULL,
    "tenantKey"   TEXT NOT NULL DEFAULT 'default',
    "productId"   TEXT NOT NULL,
    "marketId"    TEXT NOT NULL,
    "title"       TEXT,
    "description" TEXT,
    "attributes"  JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductTranslation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CategoryTranslation" (
    "id"         TEXT NOT NULL,
    "tenantKey"  TEXT NOT NULL DEFAULT 'default',
    "categoryId" TEXT NOT NULL,
    "marketId"   TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CategoryTranslation_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "Market_tenantKey_code_locale_key" ON "Market"("tenantKey", "code", "locale");
CREATE UNIQUE INDEX "Currency_tenantKey_code_key" ON "Currency"("tenantKey", "code");
CREATE UNIQUE INDEX "PriceList_tenantKey_marketId_currencyId_key" ON "PriceList"("tenantKey", "marketId", "currencyId");
CREATE UNIQUE INDEX "ProductPrice_priceListId_variantId_key" ON "ProductPrice"("priceListId", "variantId");
CREATE UNIQUE INDEX "ProductTranslation_productId_marketId_key" ON "ProductTranslation"("productId", "marketId");
CREATE UNIQUE INDEX "CategoryTranslation_categoryId_marketId_key" ON "CategoryTranslation"("categoryId", "marketId");

-- Lookup indexes
CREATE INDEX "Market_tenantKey_idx" ON "Market"("tenantKey");
CREATE INDEX "Market_tenantKey_isDefault_idx" ON "Market"("tenantKey", "isDefault");
CREATE INDEX "Currency_tenantKey_idx" ON "Currency"("tenantKey");
CREATE INDEX "PriceList_tenantKey_idx" ON "PriceList"("tenantKey");
CREATE INDEX "PriceList_tenantKey_isDefault_idx" ON "PriceList"("tenantKey", "isDefault");
CREATE INDEX "ProductPrice_tenantKey_idx" ON "ProductPrice"("tenantKey");
CREATE INDEX "ProductPrice_variantId_idx" ON "ProductPrice"("variantId");
CREATE INDEX "ProductTranslation_tenantKey_idx" ON "ProductTranslation"("tenantKey");
CREATE INDEX "ProductTranslation_productId_idx" ON "ProductTranslation"("productId");
CREATE INDEX "CategoryTranslation_tenantKey_idx" ON "CategoryTranslation"("tenantKey");
CREATE INDEX "CategoryTranslation_categoryId_idx" ON "CategoryTranslation"("categoryId");

-- Foreign keys
ALTER TABLE "PriceList"
    ADD CONSTRAINT "PriceList_marketId_fkey"   FOREIGN KEY ("marketId")   REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "PriceList_currencyId_fkey"  FOREIGN KEY ("currencyId")  REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductPrice"
    ADD CONSTRAINT "ProductPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ProductPrice_variantId_fkey"   FOREIGN KEY ("variantId")   REFERENCES "Variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductTranslation"
    ADD CONSTRAINT "ProductTranslation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ProductTranslation_marketId_fkey"  FOREIGN KEY ("marketId")  REFERENCES "Market"("id")  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CategoryTranslation"
    ADD CONSTRAINT "CategoryTranslation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "CategoryTranslation_marketId_fkey"   FOREIGN KEY ("marketId")   REFERENCES "Market"("id")  ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: tenant isolation for all new tables
DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  -- Market
  ALTER TABLE "Market" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Market" FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Market' AND policyname = 'tenant_isolation_market') THEN
    EXECUTE format('CREATE POLICY tenant_isolation_market ON "Market" USING ("tenantKey" = %s) WITH CHECK ("tenantKey" = %s)', tenant_expr, tenant_expr);
  END IF;

  -- Currency
  ALTER TABLE "Currency" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "Currency" FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Currency' AND policyname = 'tenant_isolation_currency') THEN
    EXECUTE format('CREATE POLICY tenant_isolation_currency ON "Currency" USING ("tenantKey" = %s) WITH CHECK ("tenantKey" = %s)', tenant_expr, tenant_expr);
  END IF;

  -- PriceList
  ALTER TABLE "PriceList" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "PriceList" FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'PriceList' AND policyname = 'tenant_isolation_price_list') THEN
    EXECUTE format('CREATE POLICY tenant_isolation_price_list ON "PriceList" USING ("tenantKey" = %s) WITH CHECK ("tenantKey" = %s)', tenant_expr, tenant_expr);
  END IF;

  -- ProductPrice
  ALTER TABLE "ProductPrice" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "ProductPrice" FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ProductPrice' AND policyname = 'tenant_isolation_product_price') THEN
    EXECUTE format('CREATE POLICY tenant_isolation_product_price ON "ProductPrice" USING ("tenantKey" = %s) WITH CHECK ("tenantKey" = %s)', tenant_expr, tenant_expr);
  END IF;

  -- ProductTranslation
  ALTER TABLE "ProductTranslation" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "ProductTranslation" FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ProductTranslation' AND policyname = 'tenant_isolation_product_translation') THEN
    EXECUTE format('CREATE POLICY tenant_isolation_product_translation ON "ProductTranslation" USING ("tenantKey" = %s) WITH CHECK ("tenantKey" = %s)', tenant_expr, tenant_expr);
  END IF;

  -- CategoryTranslation
  ALTER TABLE "CategoryTranslation" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "CategoryTranslation" FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'CategoryTranslation' AND policyname = 'tenant_isolation_category_translation') THEN
    EXECUTE format('CREATE POLICY tenant_isolation_category_translation ON "CategoryTranslation" USING ("tenantKey" = %s) WITH CHECK ("tenantKey" = %s)', tenant_expr, tenant_expr);
  END IF;
END $$;
