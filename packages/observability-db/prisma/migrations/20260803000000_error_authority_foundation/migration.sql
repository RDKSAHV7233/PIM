CREATE TYPE "ErrorRuntime" AS ENUM ('api', 'worker', 'next_server', 'browser');
CREATE TYPE "ErrorCategory" AS ENUM (
  'internal',
  'network',
  'timeout',
  'database',
  'cache',
  'authentication',
  'authorization',
  'contract',
  'dependency',
  'rendering',
  'hydration',
  'unknown'
);
CREATE TYPE "ErrorSeverity" AS ENUM ('p0', 'p1', 'p2', 'p3');
CREATE TYPE "ErrorIssueState" AS ENUM ('open', 'muted', 'resolved');

CREATE TABLE "error_issues" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "fingerprint_version" INTEGER NOT NULL,
  "runtime" "ErrorRuntime" NOT NULL,
  "service" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "error_code" TEXT,
  "category" "ErrorCategory" NOT NULL DEFAULT 'unknown',
  "safe_title" TEXT NOT NULL,
  "severity" "ErrorSeverity" NOT NULL DEFAULT 'p2',
  "state" "ErrorIssueState" NOT NULL DEFAULT 'open',
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "first_seen_release" TEXT,
  "last_seen_release" TEXT,
  "occurrence_count" INTEGER NOT NULL DEFAULT 0,
  "affected_tenant_count" INTEGER NOT NULL DEFAULT 0,
  "latest_occurrence_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "error_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "error_occurrences" (
  "id" TEXT NOT NULL,
  "issue_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "environment" TEXT NOT NULL,
  "release" TEXT,
  "runtime" "ErrorRuntime" NOT NULL,
  "service" TEXT NOT NULL,
  "request_id" TEXT,
  "correlation_id" TEXT,
  "route_template" TEXT,
  "method" TEXT,
  "status_code" INTEGER,
  "safe_tenant_ref" TEXT,
  "safe_actor_ref" TEXT,
  "actor_type" TEXT,
  "job_id" TEXT,
  "operation_id" TEXT,
  "installation_id" TEXT,
  "error_code" TEXT,
  "category" "ErrorCategory" NOT NULL DEFAULT 'unknown',
  "safe_message" TEXT NOT NULL,
  "top_frame_file" TEXT,
  "top_frame_function" TEXT,
  "top_frame_line" INTEGER,
  "normalized_frames" JSONB,
  "stack_hash" TEXT,
  "source_event_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "error_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "error_issue_tenant_impacts" (
  "id" TEXT NOT NULL,
  "issue_id" TEXT NOT NULL,
  "safe_tenant_ref" TEXT NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "error_issue_tenant_impacts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "error_issues_group_unique"
  ON "error_issues"("environment", "runtime", "service", "fingerprint_version", "fingerprint");
CREATE INDEX "idx_error_issues_env_state_last_seen"
  ON "error_issues"("environment", "state", "last_seen_at" DESC);
CREATE INDEX "idx_error_issues_runtime_category_last_seen"
  ON "error_issues"("runtime", "category", "last_seen_at" DESC);

CREATE UNIQUE INDEX "error_occurrences_source_event_id_key"
  ON "error_occurrences"("source_event_id");
CREATE INDEX "idx_error_occurrences_issue_time"
  ON "error_occurrences"("issue_id", "occurred_at" DESC);
CREATE INDEX "idx_error_occurrences_env_runtime_time"
  ON "error_occurrences"("environment", "runtime", "occurred_at" DESC);
CREATE INDEX "idx_error_occurrences_correlation"
  ON "error_occurrences"("correlation_id");
CREATE INDEX "idx_error_occurrences_request"
  ON "error_occurrences"("request_id");
CREATE INDEX "idx_error_occurrences_job"
  ON "error_occurrences"("job_id");

CREATE UNIQUE INDEX "error_issue_tenant_impact_unique"
  ON "error_issue_tenant_impacts"("issue_id", "safe_tenant_ref");
CREATE INDEX "idx_error_issue_tenant_ref_last_seen"
  ON "error_issue_tenant_impacts"("safe_tenant_ref", "last_seen_at" DESC);

ALTER TABLE "error_occurrences"
  ADD CONSTRAINT "error_occurrences_issue_id_fkey"
  FOREIGN KEY ("issue_id") REFERENCES "error_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "error_issue_tenant_impacts"
  ADD CONSTRAINT "error_issue_tenant_impacts_issue_id_fkey"
  FOREIGN KEY ("issue_id") REFERENCES "error_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
