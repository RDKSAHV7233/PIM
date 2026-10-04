-- AI-CORE-002: tenant-scoped AiExecution telemetry persistence.
-- This migration adds persistence only. It does not add provider execution,
-- Product mutation, provider credentials, raw prompts, or raw provider responses.

CREATE TYPE "AiExecutionStatus" AS ENUM (
  'queued',
  'validating',
  'blocked',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'budget_blocked',
  'provider_disabled',
  'cancelled'
);

CREATE TYPE "AiExecutionCostSource" AS ENUM (
  'none',
  'estimated',
  'actual',
  'provider'
);

CREATE TYPE "AiExecutionFailureClass" AS ENUM (
  'validation_error',
  'classification_blocked',
  'redaction_failed',
  'tenant_policy_blocked',
  'budget_exhausted',
  'provider_disabled',
  'provider_timeout',
  'provider_rate_limited',
  'provider_auth_error',
  'provider_5xx',
  'provider_schema_invalid',
  'unsafe_output',
  'internal_error'
);

CREATE TABLE "ai_executions" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  "capability" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "source_record_id" TEXT,
  "source_version" INTEGER NOT NULL,
  "source_hash" TEXT NOT NULL,
  "request_fingerprint" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "idempotency_fingerprint" TEXT NOT NULL,
  "created_by_actor_id" TEXT,
  "created_by_actor_role" TEXT,
  "correlation_id" TEXT,
  "status" "AiExecutionStatus" NOT NULL DEFAULT 'queued',
  "provider_key" TEXT,
  "provider_display_name" TEXT,
  "provider_request_id" TEXT,
  "model_key" TEXT,
  "model_version" TEXT,
  "provider_region" TEXT,
  "provider_policy_version" TEXT,
  "classification_policy_version" TEXT,
  "redaction_policy_version" TEXT,
  "prompt_template_hash" TEXT,
  "schema_hash" TEXT,
  "output_contract_version" TEXT,
  "capability_contract_version" TEXT,
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,
  "duration_ms" INTEGER,
  "attempt_number" INTEGER NOT NULL DEFAULT 1,
  "max_attempts" INTEGER NOT NULL DEFAULT 1,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
  "reasoning_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "billable_units" INTEGER NOT NULL DEFAULT 0,
  "estimated_cost_micros" INTEGER NOT NULL DEFAULT 0,
  "actual_cost_micros" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "cost_source" "AiExecutionCostSource" NOT NULL DEFAULT 'none',
  "pricing_version" TEXT,
  "budget_period_key" TEXT,
  "failure_class" "AiExecutionFailureClass",
  "failure_code" TEXT,
  "failure_message_safe" TEXT,
  "provider_status_code" INTEGER,
  "provider_call_attempted" BOOLEAN NOT NULL DEFAULT false,
  "audit_event_ids" JSONB NOT NULL DEFAULT '[]',
  "validation_evidence_id" TEXT,
  "classification_evidence_id" TEXT,
  "redaction_evidence_id" TEXT,
  "request_payload_hash" TEXT,
  "response_payload_hash" TEXT,
  "generated_payload_hash" TEXT,
  "suggestion_ids" JSONB NOT NULL DEFAULT '[]',
  "request_payload_storage_ref" TEXT,
  "response_payload_storage_ref" TEXT,
  "contains_blocked_data" BOOLEAN NOT NULL DEFAULT false,
  "contains_credentials" BOOLEAN NOT NULL DEFAULT false,
  "redacted_fields" JSONB NOT NULL DEFAULT '[]',
  "blocked_fields" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_executions_tenant_idempotency_unique"
  ON "ai_executions"("tenant_key", "idempotency_fingerprint");
CREATE INDEX "idx_ai_executions_tenant_capability_status_created"
  ON "ai_executions"("tenant_key", "capability", "status", "created_at" DESC);
CREATE INDEX "idx_ai_executions_tenant_provider_model_status_created"
  ON "ai_executions"("tenant_key", "provider_key", "model_key", "status", "created_at" DESC);
CREATE INDEX "idx_ai_executions_tenant_entity_created"
  ON "ai_executions"("tenant_key", "entity_type", "entity_id", "created_at" DESC);
CREATE INDEX "idx_ai_executions_tenant_budget_period"
  ON "ai_executions"("tenant_key", "budget_period_key");

ALTER TABLE "ai_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_executions" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_executions' AND policyname = 'tenant_isolation_ai_executions'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_ai_executions ON "ai_executions" USING ("tenant_key" = %s) WITH CHECK ("tenant_key" = %s)',
      tenant_expr,
      tenant_expr
    );
  END IF;
END
$$;
