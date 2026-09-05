-- CTO review follow-up (PR #719, 2026-09-05): lets a failed BulkEditOperationItem carry
-- the same structured error shape (resource, limit, current, upgrade_url, contact_url)
-- the single-product/export/media plan-limit flows already return over HTTP, so the
-- client can show the same upgrade CTA instead of a plain-text errorMessage.

-- AlterTable
ALTER TABLE "BulkEditOperationItem" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "BulkEditOperationItem" ADD COLUMN "errorDetails" JSONB;
