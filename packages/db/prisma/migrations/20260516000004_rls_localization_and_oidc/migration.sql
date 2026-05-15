-- Enable RLS and add tenant isolation policies for localization tables (INC-36 RG-C3)
-- and the oidc_configs table (INC-39 RG-C1).

ALTER TABLE "Market"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Market"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "Currency"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Currency"             FORCE ROW LEVEL SECURITY;
ALTER TABLE "PriceList"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceList"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductPrice"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductPrice"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProductTranslation"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductTranslation"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "CategoryTranslation"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CategoryTranslation"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "oidc_configs"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oidc_configs"         FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Market'
      AND policyname = 'tenant_isolation_market'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_market ON "Market"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Currency'
      AND policyname = 'tenant_isolation_currency'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_currency ON "Currency"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'PriceList'
      AND policyname = 'tenant_isolation_price_list'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_price_list ON "PriceList"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ProductPrice'
      AND policyname = 'tenant_isolation_product_price'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_product_price ON "ProductPrice"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ProductTranslation'
      AND policyname = 'tenant_isolation_product_translation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_product_translation ON "ProductTranslation"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'CategoryTranslation'
      AND policyname = 'tenant_isolation_category_translation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_category_translation ON "CategoryTranslation"
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oidc_configs'
      AND policyname = 'tenant_isolation_oidc_configs'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_oidc_configs ON oidc_configs
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
