-- AI-CORE-003: tenant-scoped immutable AiSuggestion provenance persistence.
-- This migration adds persistence only. It does not add provider execution,
-- Product mutation, provider credentials, raw prompts, or raw provider responses.

CREATE TYPE "AiSuggestionStatus" AS ENUM (
  'generated',
  'pending_review',
  'accepted',
  'edited',
  'rejected',
  'blocked_stale',
  'blocked_tampered',
  'blocked_unauthorized',
  'applied'
);

CREATE TYPE "AiSuggestionReviewDecision" AS ENUM (
  'accept',
  'edit',
  'reject'
);

CREATE TABLE "ai_suggestions" (
  "id" TEXT NOT NULL,
  "tenant_key" TEXT NOT NULL DEFAULT COALESCE(NULLIF(current_setting('app.tenant_key', true), ''), 'default'),
  "execution_id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "field_path" TEXT NOT NULL,
  "attribute_family" TEXT,
  "source_record_id" TEXT NOT NULL,
  "source_version" INTEGER NOT NULL,
  "source_hash" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "generation_fingerprint" TEXT NOT NULL,
  "idempotency_fingerprint" TEXT NOT NULL,
  "generated_payload" JSONB NOT NULL,
  "generated_payload_hash" TEXT NOT NULL,
  "suggested_value" JSONB NOT NULL,
  "suggested_value_hash" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "requires_evidence" BOOLEAN NOT NULL DEFAULT true,
  "evidence_hash" TEXT,
  "status" "AiSuggestionStatus" NOT NULL DEFAULT 'generated',
  "review_decision" "AiSuggestionReviewDecision",
  "reviewed_value" JSONB,
  "reviewed_value_hash" TEXT,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMPTZ,
  "review_reason" TEXT,
  "applied_value" JSONB,
  "applied_value_hash" TEXT,
  "applied_at" TIMESTAMPTZ,
  "product_service_apply_transaction_id" TEXT,
  "validation_evidence_id" TEXT,
  "audit_event_ids" JSONB NOT NULL DEFAULT '[]',
  "evaluation" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_suggestions_execution_id_fkey"
    FOREIGN KEY ("execution_id") REFERENCES "ai_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ai_suggestions_tenant_idempotency_unique"
  ON "ai_suggestions"("tenant_key", "idempotency_fingerprint");
CREATE INDEX "idx_ai_suggestions_tenant_execution"
  ON "ai_suggestions"("tenant_key", "execution_id");
CREATE INDEX "idx_ai_suggestions_tenant_capability_status_created"
  ON "ai_suggestions"("tenant_key", "capability", "status", "created_at" DESC);
CREATE INDEX "idx_ai_suggestions_tenant_entity_field"
  ON "ai_suggestions"("tenant_key", "entity_type", "entity_id", "field_path");
CREATE INDEX "idx_ai_suggestions_tenant_review_decision"
  ON "ai_suggestions"("tenant_key", "review_decision", "reviewed_at" DESC);

CREATE OR REPLACE FUNCTION ai_suggestions_reject_generated_field_update()
RETURNS trigger AS $$
BEGIN
  IF OLD.tenant_key IS DISTINCT FROM NEW.tenant_key
    OR OLD.execution_id IS DISTINCT FROM NEW.execution_id
    OR OLD.capability IS DISTINCT FROM NEW.capability
    OR OLD.entity_type IS DISTINCT FROM NEW.entity_type
    OR OLD.entity_id IS DISTINCT FROM NEW.entity_id
    OR OLD.field_path IS DISTINCT FROM NEW.field_path
    OR OLD.attribute_family IS DISTINCT FROM NEW.attribute_family
    OR OLD.source_record_id IS DISTINCT FROM NEW.source_record_id
    OR OLD.source_version IS DISTINCT FROM NEW.source_version
    OR OLD.source_hash IS DISTINCT FROM NEW.source_hash
    OR OLD.prompt_version IS DISTINCT FROM NEW.prompt_version
    OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
    OR OLD.generation_fingerprint IS DISTINCT FROM NEW.generation_fingerprint
    OR OLD.idempotency_fingerprint IS DISTINCT FROM NEW.idempotency_fingerprint
    OR OLD.generated_payload IS DISTINCT FROM NEW.generated_payload
    OR OLD.generated_payload_hash IS DISTINCT FROM NEW.generated_payload_hash
    OR OLD.suggested_value IS DISTINCT FROM NEW.suggested_value
    OR OLD.suggested_value_hash IS DISTINCT FROM NEW.suggested_value_hash
    OR OLD.confidence IS DISTINCT FROM NEW.confidence
    OR OLD.evidence IS DISTINCT FROM NEW.evidence
    OR OLD.requires_evidence IS DISTINCT FROM NEW.requires_evidence
    OR OLD.evidence_hash IS DISTINCT FROM NEW.evidence_hash THEN
    RAISE EXCEPTION 'AiSuggestion generated fields are immutable after generation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_suggestions_generated_fields_immutable
BEFORE UPDATE ON "ai_suggestions"
FOR EACH ROW
EXECUTE FUNCTION ai_suggestions_reject_generated_field_update();

ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tenant_expr TEXT := 'COALESCE(NULLIF(current_setting(''app.tenant_key'', true), ''''), ''default'')';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_suggestions' AND policyname = 'tenant_isolation_ai_suggestions'
  ) THEN
    EXECUTE format(
      'CREATE POLICY tenant_isolation_ai_suggestions ON "ai_suggestions" USING ("tenant_key" = %s) WITH CHECK ("tenant_key" = %s)',
      tenant_expr,
      tenant_expr
    );
  END IF;
END
$$;
