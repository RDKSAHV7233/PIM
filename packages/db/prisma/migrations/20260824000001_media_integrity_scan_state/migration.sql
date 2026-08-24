CREATE TABLE "media_integrity_scan_runs" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'read_only',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "cursor_created_at" TIMESTAMP(3),
  "cursor_id" TEXT,
  "rows_examined" INTEGER NOT NULL DEFAULT 0,
  "rows_eligible" INTEGER,
  "coverage_complete" BOOLEAN NOT NULL DEFAULT false,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "continuation_pending" BOOLEAN NOT NULL DEFAULT false,
  "limits" JSONB NOT NULL DEFAULT '{}',
  "storage" JSONB NOT NULL DEFAULT '{}',
  "totals" JSONB NOT NULL DEFAULT '{}',
  "by_storage_kind" JSONB NOT NULL DEFAULT '{}',
  "impact" JSONB NOT NULL DEFAULT '{}',
  "safety" JSONB NOT NULL DEFAULT '{}',
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "media_integrity_scan_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_integrity_scan_checkpoints" (
  "checkpoint_key" TEXT NOT NULL,
  "cursor_created_at" TIMESTAMP(3),
  "cursor_id" TEXT,
  "last_run_id" TEXT,
  "cycle_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rows_eligible" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "media_integrity_scan_checkpoints_pkey" PRIMARY KEY ("checkpoint_key")
);

CREATE INDEX "idx_media_integrity_runs_started" ON "media_integrity_scan_runs"("started_at" DESC);
CREATE INDEX "idx_media_integrity_runs_status_started" ON "media_integrity_scan_runs"("status", "started_at" DESC);
