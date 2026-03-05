-- RLS repair migration for account privacy tables + KPI metrics events.
-- Ensures policies exist in environments where earlier migrations were applied
-- before policy additions or where manual drift removed policies.

ALTER TABLE account_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE account_consent_events FORCE ROW LEVEL SECURITY;
ALTER TABLE account_export_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_requests FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_consent_events'
      AND policyname = 'tenant_isolation_account_consent_events'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_account_consent_events
      ON account_consent_events
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_export_requests'
      AND policyname = 'tenant_isolation_account_export_requests'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_account_export_requests
      ON account_export_requests
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'account_deletion_requests'
      AND policyname = 'tenant_isolation_account_deletion_requests'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation_account_deletion_requests
      ON account_deletion_requests
      USING (tenant_key = ' || tenant_expr || ')
      WITH CHECK (tenant_key = ' || tenant_expr || ')';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'kpi_metric_events'
  ) THEN
    EXECUTE 'ALTER TABLE kpi_metric_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE kpi_metric_events FORCE ROW LEVEL SECURITY';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'kpi_metric_events'
        AND policyname = 'tenant_isolation_kpi_metric_events'
    ) THEN
      EXECUTE 'CREATE POLICY tenant_isolation_kpi_metric_events
        ON kpi_metric_events
        USING (tenant_key = ' || tenant_expr || ')
        WITH CHECK (tenant_key = ' || tenant_expr || ')';
    END IF;
  END IF;
END $$;
