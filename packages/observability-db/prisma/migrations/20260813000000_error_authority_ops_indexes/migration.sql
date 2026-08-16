CREATE INDEX IF NOT EXISTS "idx_error_issues_ops_filters"
  ON "error_issues"("environment", "runtime", "service", "severity", "state", "last_seen_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "idx_error_issues_ops_release"
  ON "error_issues"("environment", "last_seen_release", "last_seen_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "idx_error_issues_ops_error_code"
  ON "error_issues"("environment", "error_code", "last_seen_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "idx_error_occurrences_ops_route"
  ON "error_occurrences"("route_template", "occurred_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "idx_error_occurrences_ops_release"
  ON "error_occurrences"("release", "occurred_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "idx_error_occurrences_ops_error_code"
  ON "error_occurrences"("error_code", "occurred_at" DESC, "id" DESC);
