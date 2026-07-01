-- Postgres forbids using a newly-added enum value (added in
-- 20260701000001_bulk_edit_queued_status) within the same transaction it was
-- added in ("unsafe use of new value ... New enum values must be committed
-- before they can be used" — error 55P04). Split into its own migration so
-- 'queued' is committed before this default is set.
ALTER TABLE "BulkEditOperation" ALTER COLUMN "status" SET DEFAULT 'queued';
