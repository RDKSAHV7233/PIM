-- Composite indexes for BulkImportJob, BulkEditOperation, and AttributeDefinition.
--
-- BulkImportJob — query patterns served:
--   Worker/dashboard poll: WHERE tenantKey = ? AND status IN (?) ORDER BY updatedAt ASC
--   [status, updatedAt] and [tenantKey] are already present but separate;
--   a compound WHERE tenantKey + status cannot use either efficiently.
--   [tenantKey, status, updatedAt] supersedes [status, updatedAt] for all
--   multi-tenant queries and keeps the single-tenant query path equally fast.
--
-- BulkEditOperation — same gap as BulkImportJob:
--   Worker poll: WHERE tenantKey = ? AND status IN (?) ORDER BY updatedAt ASC
--   [status, updatedAt] and [tenantKey] exist separately; compound filter forces
--   the planner to pick one and filter in memory. New composite eliminates that.
--
-- AttributeDefinition — query patterns served:
--   compliance hot path: WHERE categoryId = ? AND appliesTo = 'product'
--   Called from validateAndPersistProduct on every product save/approve and on
--   every row in bulk import/edit. @@unique([categoryId, key, appliesTo]) exists
--   but has key as the second column — it cannot efficiently serve equality on
--   (categoryId, appliesTo) alone without covering key.
--   [categoryId, appliesTo] gives the planner a tight index scan for the two
--   equality predicates in the compliance attribute lookup.

CREATE INDEX IF NOT EXISTS "BulkImportJob_tenantKey_status_updatedAt_idx"
    ON "BulkImportJob" ("tenantKey", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "BulkEditOperation_tenantKey_status_updatedAt_idx"
    ON "BulkEditOperation" ("tenantKey", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "AttributeDefinition_categoryId_appliesTo_idx"
    ON "AttributeDefinition" ("categoryId", "appliesTo");
