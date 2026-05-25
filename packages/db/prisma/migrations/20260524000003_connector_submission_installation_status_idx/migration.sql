-- no transaction
-- Composite index for ConnectorSubmission installation + status queries.
--
-- ConnectorSubmission — query patterns served:
--   Marketplace recovery:   WHERE tenantKey = ? AND installationId = ? AND status = 'FAILED'
--   Shopify match builder:  WHERE tenantKey = ? AND installationId = ? AND status = 'SUCCESS' ...
--   Issue inbox scope:      WHERE tenantKey = ? AND installationId = ? (DISTINCT productId)
--   Dashboard readiness:    WHERE tenantKey = ? AND installationId IN (?) AND status = 'SUCCESS'
--
--   The existing unique index [tenantKey, installationId, idempotencyKey] can serve
--   [tenantKey, installationId] as a prefix, but includes idempotencyKey as the third column
--   which does not help when the actual discriminator in the query is status.
--   [tenantKey, installationId, status] gives the planner a tight three-column index scan
--   for all installation-scoped queries that also filter by status (FAILED, SUCCESS, etc.).
--
-- CONCURRENTLY: safe to apply against a live database without blocking writes.
-- Prisma migrate-deploy runs this file outside a transaction (required when
-- CONCURRENTLY is present; the file must contain no other statements).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "connector_submissions_tenant_installation_status_idx"
    ON "connector_submissions" ("tenant_key", "installation_id", "status");
