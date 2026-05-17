-- Composite index on AuditLog to support product revision and activity queries.
--
-- Query patterns served:
--   getProductRevisions: WHERE resource_id = ? AND action IN ('PRODUCT_UPDATED','REVIEW_DECISION') ORDER BY created_at DESC, id DESC
--   getProductActivity:  WHERE resource_id = ?                                                     ORDER BY created_at DESC, id DESC
--
-- Both endpoints are tenant-isolated by RLS at runtime; the tenant_key column is included
-- as the leading index column to preserve RLS-friendly access paths and to keep this
-- index colocated per tenant in clustered scenarios.
--
-- ADR-013 references this index for the AuditLog-sourced revision history pattern.
-- CONCURRENTLY is used so this migration is safe to apply against a live database
-- without blocking writes. Prisma migrate-deploy executes outside a transaction when
-- CONCURRENTLY is present (the file must contain no other statements that require
-- a transaction).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant_resource_action_created
ON "audit_logs" (tenant_key, resource_id, action, created_at DESC);
