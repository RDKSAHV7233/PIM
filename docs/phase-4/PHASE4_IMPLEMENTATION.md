# Phase 4 Implementation (Bulk Operations) - Slice 3

## Scope Implemented
- Bulk import job model with explicit chunk/retry/DLQ status tracking.
- Bulk import row model with per-row retries, error reason, and product linkage.
- Bulk import API module:
  - create job (`csv` or `json` sources)
  - mapping suggestion by header similarity
  - list jobs
  - fetch job + row snapshot
  - process next chunk
  - process specific row
  - repair row payload
  - requeue dead-letter rows
- Bulk edit API module:
  - preview affected products by scope filter
  - apply updates across filtered products
  - operation history with per-product before/after audit rows
- Row processing behavior:
  - chunk-limited processing
  - per-row retry increments
  - dead-letter transition after max retries
  - product creation + compliance validation on success
- Bulk edit behavior:
  - supports selected fields (`title`, `description`, `brand`, `status`, `hsnCode`, `gstRate`)
  - preview returns affected count + sample set before apply
  - history logs operation totals and item-level outcome
- Web console support:
  - create bulk import jobs
  - inspect job counters/status
  - process next chunk
  - view selected job rows
  - repair row payload JSON
  - process repaired row immediately
  - requeue DLQ rows
  - bulk edit preview/apply form
  - bulk edit history table
- Phase 4 smoke script covering:
  - mapping suggestion endpoint
  - successful csv import
  - retrying -> dead_letter transitions
  - dead-letter row repair and row-level reprocess
  - DLQ requeue
  - bulk edit preview/apply/history

## Data Model Added
- `BulkImportJobStatus` enum.
- `BulkImportRowStatus` enum.
- `BulkImportJob` table.
- `BulkImportRow` table.
- `BulkEditOperationStatus` enum.
- `BulkEditItemStatus` enum.
- `BulkEditOperation` table.
- `BulkEditOperationItem` table.

## API Endpoints Added
- `POST /api/bulk-import/jobs`
- `GET /api/bulk-import/jobs`
- `GET /api/bulk-import/jobs/:id`
- `GET /api/bulk-import/jobs/:id/rows`
- `POST /api/bulk-import/jobs/:id/process`
- `POST /api/bulk-import/jobs/:id/requeue-dlq`
- `POST /api/bulk-edit/preview`
- `POST /api/bulk-edit/apply`
- `GET /api/bulk-edit/operations`
- `GET /api/bulk-edit/operations/:id`

## Notes
- Bulk edit workflow now satisfies `P4-US-005` acceptance criteria (filtered update, preview before apply, history log).
- Remaining Phase 4 MVP gate items: `.xlsx/.xls` upload UX and error report export.
