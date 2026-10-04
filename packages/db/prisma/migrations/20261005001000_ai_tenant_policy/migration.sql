-- AI-POL-001: tenant-scoped AI policy persistence and data classification foundation.
-- This migration adds policy storage only. It does not add provider execution,
-- provider credentials, Product mutation, raw prompts, or raw provider responses.

CREATE TYPE "AiDataClassification" AS ENUM (
  'AI_ALLOWED',
  'AI_ALLOWED_WITH_REDACTION',
  'AI_BLOCKED'
);

CREATE TYPE "AiTenantPolicyStatus" AS ENUM (
  'draft',
  'active',
  'disabled'
);

CREATE TABLE "ai_tenant_policies" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  "capability" TEXT NOT NULL DEFAULT 'product_intelligence',
  "provider_key" TEXT NOT NULL DEFAULT 'default',
  "policy_version" TEXT NOT NULL,
  "status" "AiTenantPolicyStatus" NOT NULL DEFAULT 'draft',
  "intelligence_enabled" BOOLEAN NOT NULL DEFAULT false,
  "provider_execution_enabled" BOOLEAN NOT NULL DEFAULT false,
  "kill_switch_enabled" BOOLEAN NOT NULL DEFAULT true,
  "tenant_opt_out" BOOLEAN NOT NULL DEFAULT true,
  "allow_model_training" BOOLEAN NOT NULL DEFAULT false,
  "allow_human_provider_review" BOOLEAN NOT NULL DEFAULT false,
  "allow_raw_payload_storage" BOOLEAN NOT NULL DEFAULT false,
  "retention_days" INTEGER NOT NULL DEFAULT 0,
  "max_payload_bytes" INTEGER NOT NULL DEFAULT 0,
  "default_classification" "AiDataClassification" NOT NULL DEFAULT 'AI_BLOCKED',
  "allowed_capabilities" JSONB NOT NULL DEFAULT '[]',
  "allowed_provider_keys" JSONB NOT NULL DEFAULT '[]',
  "field_classifications" JSONB NOT NULL DEFAULT '{}',
  "redaction_policy_version" TEXT NOT NULL,
  "classification_policy_hash" TEXT NOT NULL,
  "data_use_notes" TEXT,
  "approved_by" TEXT,
  "approved_at" TIMESTAMPTZ,
  "audit_event_ids" JSONB NOT NULL DEFAULT '[]',
  "created_by_actor_id" TEXT,
  "updated_by_actor_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_tenant_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_tenant_policies_tenant_capability_provider_version_unique"
  ON "ai_tenant_policies"("tenant_key", "capability", "provider_key", "policy_version");
CREATE INDEX "idx_ai_tenant_policies_tenant_capability_provider_status"
  ON "ai_tenant_policies"("tenant_key", "capability", "provider_key", "status");
CREATE INDEX "idx_ai_tenant_policies_tenant_kill_switch"
  ON "ai_tenant_policies"("tenant_key", "kill_switch_enabled");
CREATE INDEX "idx_ai_tenant_policies_tenant_status_updated"
  ON "ai_tenant_policies"("tenant_key", "status", "updated_at" DESC);

ALTER TABLE "ai_tenant_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_tenant_policies" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_tenant_policies' AND policyname = 'tenant_isolation_ai_tenant_policies'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_ai_tenant_policies ON "ai_tenant_policies" USING ("tenant_key" = %s) WITH CHECK ("tenant_key" = %s)',
      tenant_expr,
      tenant_expr
    );
  END IF;
END
$$;
