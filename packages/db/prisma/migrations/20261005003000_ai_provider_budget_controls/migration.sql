-- AI-PROV-004a: provider-neutral budget controls and reservation state.
-- This migration adds control-plane persistence only. It does not add provider
-- SDKs, credentials, outbound requests, Product mutation, suggestion persistence,
-- raw prompts, or raw provider responses.
--
-- Forward/rollback strategy:
-- - Applying this migration is non-destructive: it creates new empty tables only.
-- - Existing tenants receive no permissive row. Missing policy/budget rows must
--   deny live-provider execution.
-- - Rollback before live-provider use may drop these two tables. After reservations
--   exist, rollback must first reconcile or cancel reservations as an operator step.
-- - Atomic reservation is expected to update ai_provider_budget_policies with a
--   conditional statement that checks current counters and increments in one write.

CREATE TABLE "ai_provider_budget_policies" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  "capability" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL DEFAULT 'default',
  "execution_mode" TEXT NOT NULL DEFAULT 'live_provider',
  "policy_version" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "request_limit" INTEGER NOT NULL DEFAULT 0,
  "spend_limit_micros" INTEGER NOT NULL DEFAULT 0,
  "reserved_spend_micros" INTEGER NOT NULL DEFAULT 0,
  "spent_spend_micros" INTEGER NOT NULL DEFAULT 0,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "period_key" TEXT NOT NULL,
  "period_started_at" TIMESTAMPTZ NOT NULL,
  "period_ends_at" TIMESTAMPTZ NOT NULL,
  "effective_from" TIMESTAMPTZ,
  "effective_until" TIMESTAMPTZ,
  "updated_by_actor_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_provider_budget_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_budget_policies_non_negative_limits_check" CHECK (
    "request_limit" >= 0
    AND "spend_limit_micros" >= 0
    AND "reserved_spend_micros" >= 0
    AND "spent_spend_micros" >= 0
    AND "request_count" >= 0
  ),
  CONSTRAINT "ai_provider_budget_policies_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ai_provider_budget_policies_period_check" CHECK ("period_ends_at" > "period_started_at")
);

CREATE UNIQUE INDEX "ai_provider_budget_policies_scope_version_unique"
  ON "ai_provider_budget_policies"("tenant_key", "capability", "provider_key", "execution_mode", "period_key", "policy_version");
CREATE INDEX "idx_ai_provider_budget_policies_scope_enabled"
  ON "ai_provider_budget_policies"("tenant_key", "capability", "provider_key", "execution_mode", "period_key", "enabled");
CREATE INDEX "idx_ai_provider_budget_policies_tenant_period"
  ON "ai_provider_budget_policies"("tenant_key", "period_key", "enabled");

CREATE TABLE "ai_provider_budget_reservations" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  "budget_policy_id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL DEFAULT 'default',
  "execution_mode" TEXT NOT NULL DEFAULT 'live_provider',
  "period_key" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "requested_estimated_cost_micros" INTEGER NOT NULL,
  "reserved_cost_micros" INTEGER NOT NULL DEFAULT 0,
  "actual_cost_micros" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "correlation_id" TEXT,
  "execution_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_provider_budget_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_budget_reservations_policy_fkey"
    FOREIGN KEY ("budget_policy_id") REFERENCES "ai_provider_budget_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_provider_budget_reservations_non_negative_costs_check" CHECK (
    "requested_estimated_cost_micros" >= 0
    AND "reserved_cost_micros" >= 0
    AND ("actual_cost_micros" IS NULL OR "actual_cost_micros" >= 0)
  ),
  CONSTRAINT "ai_provider_budget_reservations_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ai_provider_budget_reservations_status_check" CHECK ("status" IN ('reserved', 'budget_blocked', 'reconciled', 'cancelled'))
);

CREATE UNIQUE INDEX "ai_provider_budget_reservations_tenant_fingerprint_unique"
  ON "ai_provider_budget_reservations"("tenant_key", "request_fingerprint");
CREATE INDEX "idx_ai_provider_budget_reservations_policy_status"
  ON "ai_provider_budget_reservations"("tenant_key", "budget_policy_id", "status");
CREATE INDEX "idx_ai_provider_budget_reservations_scope"
  ON "ai_provider_budget_reservations"("tenant_key", "capability", "provider_key", "execution_mode", "period_key");

ALTER TABLE "ai_provider_budget_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_provider_budget_policies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_provider_budget_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_provider_budget_reservations" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_provider_budget_policies' AND policyname = 'tenant_isolation_ai_provider_budget_policies'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_ai_provider_budget_policies ON "ai_provider_budget_policies" USING ("tenant_key" = %s) WITH CHECK ("tenant_key" = %s)',
      tenant_expr,
      tenant_expr
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_provider_budget_reservations' AND policyname = 'tenant_isolation_ai_provider_budget_reservations'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_ai_provider_budget_reservations ON "ai_provider_budget_reservations" USING ("tenant_key" = %s) WITH CHECK ("tenant_key" = %s)',
      tenant_expr,
      tenant_expr
    );
  END IF;
END
$$;
