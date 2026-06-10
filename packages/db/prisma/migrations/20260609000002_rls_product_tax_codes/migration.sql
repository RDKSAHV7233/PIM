-- Enable tenant RLS on product_tax_codes.
-- tax_regimes is intentionally excluded — it is a system-level registry,
-- not per-tenant, so it has no tenantKey column and needs no isolation policy.

ALTER TABLE "product_tax_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_tax_codes" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_tax_codes'
      AND policyname = 'tenant_isolation_product_tax_codes'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_product_tax_codes
      ON product_tax_codes
      USING ("tenantKey" = ' || tenant_expr || ')
      WITH CHECK ("tenantKey" = ' || tenant_expr || ')';
  END IF;
END $$;
