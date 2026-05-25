-- Composite indexes for ValidationIssue and MarketplaceExportJob.
--
-- Query patterns served:
--   Issue inbox:      WHERE tenantKey = ? AND status = 'open' ORDER BY severity, createdAt
--   Product issues:   WHERE tenantKey = ? AND status = 'open' AND productId = ?
--   Job worker poll:  WHERE tenantKey = ? AND status IN (...) AND channel = ?
--   Job status list:  WHERE tenantKey = ? AND status = ? ORDER BY updatedAt DESC
--
-- Note: CONCURRENTLY is NOT used here because Prisma wraps all migrations in a
-- transaction block, and PostgreSQL prohibits CREATE INDEX CONCURRENTLY inside a
-- transaction (error code 25001). IF NOT EXISTS makes these re-runnable safely.

CREATE INDEX IF NOT EXISTS "idx_validation_issue_tenant_status_product"
ON "ValidationIssue" ("tenantKey", "status", "productId");

CREATE INDEX IF NOT EXISTS "idx_validation_issue_tenant_severity_status"
ON "ValidationIssue" ("tenantKey", "severity", "status");

CREATE INDEX IF NOT EXISTS "idx_marketplace_export_job_tenant_status_channel"
ON "MarketplaceExportJob" ("tenantKey", "status", "channel");

CREATE INDEX IF NOT EXISTS "idx_marketplace_export_job_tenant_status_updated"
ON "MarketplaceExportJob" ("tenantKey", "status", "updatedAt" DESC);
