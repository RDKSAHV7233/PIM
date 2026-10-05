-- AI-PROV-004b-i: provider budget lifecycle, platform controls and BIGINT money.
-- Design: docs/qa/ai-prov-004b-design-2026-10-05.md (#1176, #1178).
--
-- This migration is control-plane persistence only. It adds no provider SDK, credential,
-- outbound request, Product mutation, suggestion persistence, raw prompt or raw response.
--
-- Safety properties:
-- - Every default is deny: no budget rows are created, every limit defaults to zero, the platform
--   control row is seeded disabled with the kill switch on and no tenant allow-listed.
-- - The 004a tables (ai_provider_budget_policies, ai_provider_budget_reservations) are empty: no
--   code path has written them, so widening their columns is instant.
-- - ai_executions may hold rows from the fixture path. Widening INTEGER -> BIGINT is value
--   preserving; it rewrites the table under a short ACCESS EXCLUSIVE lock, and the table is small.
--
-- Forward-fix / rollback:
-- - Widening a column loses nothing and old readers keep working until a value exceeds 2^31 - 1,
--   which cannot happen before a budget is configured, so no rollback of the type change is needed.
-- - The new tables and columns are additive. Before any reservation exists they may be dropped.
--   After reservations exist, reconcile or cancel them first (sweepExpired, then the counter audit).
-- - The status CHECK is replaced by a superset, and the unique key is widened (tenant, fingerprint) ->
--   (tenant, fingerprint, attempt). Both are safe on empty tables; attempt_number defaults to 1.

-- 1. BIGINT for every *_micros column.
ALTER TABLE "ai_provider_budget_policies"
  ALTER COLUMN "spend_limit_micros" TYPE BIGINT,
  ALTER COLUMN "reserved_spend_micros" TYPE BIGINT,
  ALTER COLUMN "spent_spend_micros" TYPE BIGINT;

ALTER TABLE "ai_provider_budget_reservations"
  ALTER COLUMN "requested_estimated_cost_micros" TYPE BIGINT,
  ALTER COLUMN "reserved_cost_micros" TYPE BIGINT,
  ALTER COLUMN "actual_cost_micros" TYPE BIGINT;

ALTER TABLE "ai_executions"
  ALTER COLUMN "estimated_cost_micros" TYPE BIGINT,
  ALTER COLUMN "actual_cost_micros" TYPE BIGINT;

-- Sanity ceiling: USD 1,000,000 in micros. Catches a dollars-versus-micros unit error.
ALTER TABLE "ai_provider_budget_policies"
  ADD CONSTRAINT "ai_provider_budget_policies_spend_limit_ceiling_check" CHECK ("spend_limit_micros" <= 1000000000000);

-- 2. Reservation lifecycle columns, status set and key.
ALTER TABLE "ai_provider_budget_reservations"
  ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  ADD COLUMN "claimed_at" TIMESTAMPTZ,
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ,
  ADD COLUMN "claim_token" TEXT,
  ADD COLUMN "settled_at" TIMESTAMPTZ,
  ADD COLUMN "settlement_reason" TEXT;

ALTER TABLE "ai_provider_budget_reservations"
  ADD CONSTRAINT "ai_provider_budget_reservations_attempt_check" CHECK ("attempt_number" >= 1),
  ADD CONSTRAINT "ai_provider_budget_reservations_claim_check" CHECK (
    "status" <> 'dispatching' OR ("claim_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
  );

ALTER TABLE "ai_provider_budget_reservations" DROP CONSTRAINT "ai_provider_budget_reservations_status_check";
ALTER TABLE "ai_provider_budget_reservations"
  ADD CONSTRAINT "ai_provider_budget_reservations_status_check" CHECK (
    "status" IN ('reserved', 'dispatching', 'reconciled', 'cancelled', 'expired', 'budget_blocked')
  );

DROP INDEX "ai_provider_budget_reservations_tenant_fingerprint_unique";
CREATE UNIQUE INDEX "ai_prov_budget_reservations_tenant_fp_attempt_unique"
  ON "ai_provider_budget_reservations"("tenant_key", "request_fingerprint", "attempt_number");
CREATE INDEX "idx_ai_provider_budget_reservations_status_expires"
  ON "ai_provider_budget_reservations"("status", "expires_at");
CREATE INDEX "idx_ai_provider_budget_reservations_status_lease"
  ON "ai_provider_budget_reservations"("status", "lease_expires_at");

-- 3. Charges: one row per counter a reservation charged. Settlement reverses exactly these.
CREATE TABLE "ai_provider_budget_charges" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  "reservation_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "counter_row_id" TEXT NOT NULL,
  "amount_micros" BIGINT NOT NULL,
  "settled_amount_micros" BIGINT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_provider_budget_charges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_budget_charges_reservation_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "ai_provider_budget_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_provider_budget_charges_scope_check" CHECK ("scope" IN ('tenant_day', 'tenant_month', 'platform_day', 'platform_month')),
  CONSTRAINT "ai_provider_budget_charges_non_negative_check" CHECK (
    "amount_micros" >= 0 AND ("settled_amount_micros" IS NULL OR "settled_amount_micros" >= 0)
  )
);

CREATE UNIQUE INDEX "ai_provider_budget_charges_reservation_scope_unique"
  ON "ai_provider_budget_charges"("reservation_id", "scope");
CREATE INDEX "idx_ai_provider_budget_charges_tenant_reservation"
  ON "ai_provider_budget_charges"("tenant_key", "reservation_id");
CREATE INDEX "idx_ai_provider_budget_charges_counter"
  ON "ai_provider_budget_charges"("counter_row_id", "scope");

ALTER TABLE "ai_provider_budget_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_provider_budget_charges" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_provider_budget_charges' AND policyname = 'tenant_isolation_ai_provider_budget_charges'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_ai_provider_budget_charges ON "ai_provider_budget_charges" USING ("tenant_key" = %s) WITH CHECK ("tenant_key" = %s)',
      tenant_expr,
      tenant_expr
    );
  END IF;
END
$$;

-- 4. Platform control row. Deliberately global (no tenant_key): written by operators, never by an API route.
CREATE TABLE "ai_platform_controls" (
  "id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "kill_switch" BOOLEAN NOT NULL DEFAULT true,
  "allowed_provider" TEXT,
  "allowed_model" TEXT,
  "allowed_tenant_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "max_request_cost_micros" BIGINT NOT NULL DEFAULT 0,
  "updated_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_platform_controls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_platform_controls_singleton_check" CHECK ("id" = 'global'),
  CONSTRAINT "ai_platform_controls_request_cost_check" CHECK (
    "max_request_cost_micros" >= 0 AND "max_request_cost_micros" <= 1000000000000
  )
);

-- Seeded deny-all: disabled, kill switch on, no provider, no model, no tenant, request cap zero.
INSERT INTO "ai_platform_controls" ("id") VALUES ('global') ON CONFLICT ("id") DO NOTHING;

-- 5. Platform day and month counters. Deliberately global. No rows are seeded: a missing row denies.
CREATE TABLE "ai_platform_budget_periods" (
  "id" TEXT NOT NULL,
  "period_key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "spend_limit_micros" BIGINT NOT NULL DEFAULT 0,
  "reserved_spend_micros" BIGINT NOT NULL DEFAULT 0,
  "spent_spend_micros" BIGINT NOT NULL DEFAULT 0,
  "request_limit" INTEGER NOT NULL DEFAULT 0,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "period_started_at" TIMESTAMPTZ NOT NULL,
  "period_ends_at" TIMESTAMPTZ NOT NULL,
  "updated_by" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_platform_budget_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_platform_budget_periods_non_negative_check" CHECK (
    "spend_limit_micros" >= 0 AND "reserved_spend_micros" >= 0 AND "spent_spend_micros" >= 0
    AND "request_limit" >= 0 AND "request_count" >= 0
  ),
  CONSTRAINT "ai_platform_budget_periods_spend_limit_ceiling_check" CHECK ("spend_limit_micros" <= 1000000000000),
  CONSTRAINT "ai_platform_budget_periods_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ai_platform_budget_periods_period_check" CHECK ("period_ends_at" > "period_started_at")
);

CREATE UNIQUE INDEX "ai_platform_budget_periods_period_key_key" ON "ai_platform_budget_periods"("period_key");

-- 6. Explicit, read-only maintenance path for the scheduled sweeper and the counter audit.
-- These tables force row level security, so a connection with no tenant context sees only the 'default' tenant. The
-- sweeper and audit must look across tenants to find expired work, and they must not depend on owner or BYPASSRLS
-- behaviour of whatever role the worker happens to use. They set the transaction-local marker
-- app.ai_maintenance = 'on'. The policies below grant SELECT only: no marker value permits an INSERT, UPDATE or DELETE.
-- All state changes still go through a tenant-scoped connection, one tenant at a time.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_provider_budget_policies', 'ai_provider_budget_reservations', 'ai_provider_budget_charges']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'ai_maintenance_read_' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (current_setting(''app.ai_maintenance'', true) = ''on'')',
        'ai_maintenance_read_' || t,
        t
      );
    END IF;
  END LOOP;
END
$$;
