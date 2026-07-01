# BulkImportRun vs BulkImportJob

**Status:** current architecture, documented as-is. Not a target design.

## Summary

`BulkImportJob` + `BulkImportRow` are the actual processing engine and
source of truth. `BulkImportRun` is a scoping/aggregation wrapper on top of
one or more jobs — it does **not** independently track row-level state.

Do not assume `BulkImportRun`'s `status`/counter fields are authoritative.
They are recomputed from the underlying `BulkImportJob` rows every time
`refreshRunCounters()` runs (`apps/api/src/bulk-import/bulk-import-run.service.ts`).
If you need the real processing state of an import, look at the jobs.

## Why this split exists

`BulkImportJob`/`BulkImportRow` predate `BulkImportRun`. `BulkImportRun` was
added later to give large imports (30k-row ceiling, see
`LARGE_IMPORT_ROW_CEILING` in `bulk-import-run.service.ts`) a single handle
that can span multiple batched jobs (`LARGE_IMPORT_BATCH_SIZE = 1_000` rows
per job), plus file-upload/staging concerns (`sourceFileKey`,
`STAGED_FILE_EXPIRY_DAYS`) that don't belong on the job model. The
processing engine itself — row validation, product creation, retry claims,
idempotency — was never rewritten to be run-centric; it still operates on
`BulkImportJob`/`BulkImportRow`.

## What's still job-centric today

- `BulkImportService.processJob()` / `processRow()` — the actual row-by-row
  processing loop, including the optimistic-claim and idempotent-retry
  safety fixes added in `fcbaa921` (terminal-status guards, `updateMany`
  claim-before-processing, `productId` persistence for crash recovery).
- `refreshJobCounters()` — per-job counters (`processedRows`, `successRows`,
  `failedRows`, `deadLetterRows`), computed by grouping `BulkImportRow` by
  status.
- `refreshRunCounters()` — per-run counters, computed by summing
  `refreshJobCounters()` output across every `BulkImportJob` with that
  `runId`. This is a read-time aggregation, not a persisted independent
  state machine.
- The repair/retry flow operates on jobs and rows, not directly on runs.

## What's run-centric today

- Upload, staging, and large-file handling (`BulkImportStorageService`,
  `sourceFileKey`).
- Splitting a large import into multiple batched jobs
  (`LargeRunBatchPayload`, `LARGE_IMPORT_BATCH_SIZE`).
- The API surface most callers hit first (`POST /bulk-import/runs`) — but
  read/repair operations underneath still walk into job/row data.

## If you're about to change this

A full run-centric rewrite — making `BulkImportRun` the sole source of
truth and retiring `BulkImportJob`/`BulkImportRow` as implementation
details behind it — is a legitimate longer-term direction, but it's a
multi-week migration touching the processing engine, the repair UI, and
every consumer of job-shaped data. It was scoped out of the CTO review
remediation batch (2026-07) as too large/risky to bundle with smaller,
independently-testable fixes. Treat it as its own initiative if picked up.

In the meantime: when adding new import-related behavior, ask whether it
belongs at the row/job level (actual processing) or the run level
(upload/scope/aggregation) — and don't assume `BulkImportRun` fields are
live state; they're derived.
