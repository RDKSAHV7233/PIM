-- Webhook and third-party integration reliability hardening.
-- Adds durable processing state, replay-safe event persistence, and visible enqueue recovery fields.

ALTER TABLE "connector_webhook_events"
  ADD COLUMN IF NOT EXISTS "raw_body_sha256" TEXT,
  ADD COLUMN IF NOT EXISTS "processing_status" TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS "processing_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "processing_lease_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_error" TEXT;

UPDATE "connector_webhook_events"
SET "processing_status" = CASE
  WHEN "processed_at" IS NOT NULL THEN 'processed'
  WHEN "processing_status" IS NULL OR "processing_status" = 'received' THEN 'failed'
  ELSE "processing_status"
END;

CREATE INDEX IF NOT EXISTS "idx_connector_webhooks_recovery"
  ON "connector_webhook_events" ("tenant_key", "processing_status", "processing_lease_until", "received_at");

CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "id" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "tenant_key" TEXT,
  "processing_status" TEXT NOT NULL DEFAULT 'received',
  "processing_attempt_count" INTEGER NOT NULL DEFAULT 0,
  "processing_lease_until" TIMESTAMP(3),
  "last_error" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_event_unique"
  ON "stripe_webhook_events" ("external_event_id");

CREATE INDEX IF NOT EXISTS "idx_stripe_webhook_events_recovery"
  ON "stripe_webhook_events" ("processing_status", "processing_lease_until", "received_at");

ALTER TABLE "outbound_webhook_deliveries"
  ADD COLUMN IF NOT EXISTS "queue_job_id" TEXT,
  ADD COLUMN IF NOT EXISTS "last_enqueue_attempt_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "enqueue_error" TEXT;

CREATE INDEX IF NOT EXISTS "idx_outbound_webhook_deliveries_stuck_queued"
  ON "outbound_webhook_deliveries" ("tenant_key", "status", "attempted_at", "created_at");
