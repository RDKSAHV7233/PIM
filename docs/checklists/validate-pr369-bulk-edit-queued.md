# PR #369 — Bulk Edit Queued Apply End-to-End Validation Checklist

**Branch:** `feat/bulk-edit-queued-apply`
**Scope:** Queued apply(), BulkEditOperationStatus enum changes, idempotent resume, browser status display
**Gate:** Must validate Prisma migration, real BullMQ processing, and browser polling end-to-end before marking Ready for Review.

---

## Pre-requisites

- [ ] Staging or local environment with real Postgres (not SQLite)
- [ ] Real Redis running (`QUEUE_BACKEND=bullmq`, `REDIS_URL` set)
- [ ] `QUEUE_WORKER_ENABLED=true`
- [ ] Seeded workspace with at least 5 products in "draft" status (for apply testing)
- [ ] Browser access to the web app

---

## Phase 1: Database Migration

### Test 1.1: `prisma migrate deploy` succeeds

**What:** Both split migrations apply cleanly in sequence on real Postgres.

```bash
cd packages/db && npx prisma migrate deploy
```

**Expected output:**
```
Migration 20260701000001_bulk_edit_queued_status — applied
Migration 20260701000002_bulk_edit_default_queued — applied
```

No errors. No warnings about enum values.

**Pass evidence:** Terminal output showing both migrations applied.

---

### Test 1.2: Enum values exist in database

**What:** Confirm both new enum values are present in Postgres.

```sql
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname = 'BulkEditOperationStatus'
ORDER BY enumsortorder;
```

**Expected result:**
```
 enumlabel
---------------------
 queued
 processing
 completed
 completed_with_errors
 failed
```

All 5 values present, `queued` and `completed_with_errors` are new.

**Pass evidence:** Query result screenshot.

---

### Test 1.3: Default column value is `queued`

**What:** New BulkEditOperation rows default to `queued`, not `processing`.

```sql
SELECT column_default
FROM information_schema.columns
WHERE table_name = 'BulkEditOperation'
  AND column_name = 'status';
```

**Expected:** `'queued'::\"BulkEditOperationStatus\"`

**Pass evidence:** Query result screenshot.

---

## Phase 2: API — Queued Apply

### Test 2.1: Apply creates a `queued` operation

**What:** Calling the bulk-edit apply endpoint returns immediately with a `queued` operation (not `processing`).

```bash
curl -s -X POST https://<api-url>/api/v1/bulk-edit/apply \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": { "status": "draft" },
    "updates": { "brand": "TestBrand-Queued" }
  }' | jq '.status, .id'
```

**Expected:**
```
"queued"
"<operation-id>"
```

The response should return quickly (< 1s) regardless of how many products match — the work is enqueued, not done inline.

**Pass evidence:** curl response showing `status: "queued"` and the operation ID. Note the response time.

---

### Test 2.2: BullMQ/Redis processes the job

**What:** The queued job is picked up by the BullMQ worker and products are updated.

**Steps:**
1. After Test 2.1, wait 5-10 seconds.
2. Check the operation status:

```bash
curl -s https://<api-url>/api/v1/bulk-edit/operations/<operation-id> \
  -H "Authorization: Bearer <token>" | jq '.status, .appliedCount, .failedCount'
```

**Expected:** Status is `completed` (or `completed_with_errors` if some products had invalid transitions). `appliedCount > 0`.

3. Verify products were actually updated:

```bash
curl -s "https://<api-url>/api/v1/products?brand=TestBrand-Queued" \
  -H "Authorization: Bearer <token>" | jq '.data | length'
```

**Expected:** Count matches `appliedCount` from the operation.

**Pass evidence:** Operation status showing `completed` with correct counts + product query confirming the brand change.

---

### Test 2.3: Status transitions — queued -> processing -> completed

**What:** The operation transitions through all expected states.

**Steps:**
1. Create a bulk edit targeting many products (50+) so processing takes a few seconds.
2. Poll the operation status rapidly:

```bash
# Run in a loop to catch intermediate states
for i in $(seq 1 20); do
  curl -s https://<api-url>/api/v1/bulk-edit/operations/<operation-id> \
    -H "Authorization: Bearer <token>" | jq -r '.status'
  sleep 0.5
done
```

**Expected sequence:** `queued` -> `processing` -> `completed` (or `completed_with_errors`)

**Pass evidence:** Terminal output showing the state progression.

---

## Phase 3: Partial Failure — `completed_with_errors`

### Test 3.1: Trigger partial failure

**What:** When some products fail (invalid workflow transition) and others succeed, status is `completed_with_errors`.

**Steps:**
1. Ensure you have a mix of products: some in `draft` status, some in `approved` status.
2. Apply a status change that is valid for `draft` but invalid for `approved`:

```bash
curl -s -X POST https://<api-url>/api/v1/bulk-edit/apply \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": {},
    "updates": { "status": "in_review" }
  }' | jq '.id'
```

3. Wait for processing to complete, then check status:

```bash
curl -s https://<api-url>/api/v1/bulk-edit/operations/<operation-id> \
  -H "Authorization: Bearer <token>" | jq '.status, .appliedCount, .failedCount'
```

**Expected:**
- `status: "completed_with_errors"`
- `appliedCount > 0` (draft -> in_review succeeded)
- `failedCount > 0` (approved -> in_review is invalid per WORKFLOW_TRANSITIONS)

**Note:** `approved` can only transition to `archived` per the workflow rules at [bulk-edit.service.ts:28](apps/api/src/bulk-edit/bulk-edit.service.ts:28). Attempting `approved -> in_review` should produce a per-product failure.

**Pass evidence:** Operation response showing `completed_with_errors` with both appliedCount and failedCount > 0.

---

### Test 3.2: All products fail — status is `failed`

**What:** When every product in scope fails, final status is `failed`.

**Steps:**
1. Ensure all target products are in `approved` status.
2. Apply `status: "in_review"` (invalid for all).

**Expected:** `status: "failed"`, `appliedCount: 0`, `failedCount > 0`.

**Pass evidence:** Operation response showing `failed` with `appliedCount: 0`.

---

## Phase 4: Idempotency and Resume

### Test 4.1: Retry is idempotent — no duplicate updates

**What:** If the same job is re-delivered (simulated by re-enqueuing), already-processed products are skipped via the `alreadyProcessedIds` set.

**Steps:**
1. Run a normal bulk edit apply (Test 2.1). Wait for completion.
2. Record the operation's `appliedCount` and `failedCount`.
3. Manually re-enqueue the same operation (requires DB access):

```sql
-- Reset status to 'queued' to simulate re-delivery
UPDATE "BulkEditOperation"
SET status = 'queued'
WHERE id = '<operation-id>';
```

4. The worker should pick it up again. Wait for it to complete.
5. Check the operation counts:

```bash
curl -s https://<api-url>/api/v1/bulk-edit/operations/<operation-id> \
  -H "Authorization: Bearer <token>" | jq '.status, .appliedCount, .failedCount'
```

**Expected:** Counts are IDENTICAL to step 2. No duplicate `BulkEditOperationItem` rows were created. The `alreadyProcessedIds` set at [bulk-edit.service.ts:234-243](apps/api/src/bulk-edit/bulk-edit.service.ts:234) loads existing items and skips them.

6. Verify no duplicate items:

```sql
SELECT "productId", COUNT(*) as cnt
FROM "BulkEditOperationItem"
WHERE "operationId" = '<operation-id>'
GROUP BY "productId"
HAVING COUNT(*) > 1;
```

**Expected:** Zero rows (no duplicates).

**Pass evidence:** Same counts before and after re-delivery + zero-duplicate query result.

---

### Test 4.2: Resume after crash mid-batch

**What:** If the worker crashes partway through, restarting the API resumes from where it left off.

**Steps:**
1. Create a bulk edit targeting 20+ products.
2. While processing, kill the API process (simulate crash).
3. Check how many `BulkEditOperationItem` rows exist (partial progress):

```sql
SELECT COUNT(*) FROM "BulkEditOperationItem"
WHERE "operationId" = '<operation-id>';
```

4. Restart the API. The job should be redelivered by BullMQ.
5. Wait for completion and check final counts.

**Expected:**
- Operation completes successfully.
- No products were double-updated.
- `appliedCount + failedCount` = total products in scope.

**Pass evidence:** Partial item count from step 3, final operation status from step 5, no-duplicate query from Test 4.1 step 6.

---

### Test 4.3: Terminal operations are skipped on redelivery

**What:** If an operation is already `completed`/`completed_with_errors`/`failed`, a redelivered job is a no-op.

**Steps:**
1. Take a completed operation from a previous test.
2. Manually re-enqueue it WITHOUT resetting status (leave as `completed`):

```sql
-- Simulate BullMQ redelivery to a completed operation
-- (Don't change the status — leave it as 'completed')
```

3. Check API logs.

**Expected log:** No processing occurs. The guard at [bulk-edit.service.ts:210-213](apps/api/src/bulk-edit/bulk-edit.service.ts:210) short-circuits:
```
// Already terminal (completed/completed_with_errors/failed) — redelivery no-op.
```

**Pass evidence:** No new `BulkEditOperationItem` rows, operation counts unchanged.

---

## Phase 5: Browser / UI Validation

### Test 5.1: UI shows queued -> processing -> completed

**What:** The operations/bulk-edit page displays correct status labels as the job progresses.

**Steps:**
1. Open browser to `/operations/bulk-edit`.
2. Submit a bulk edit apply (enough products that processing takes a few seconds).
3. Observe the operations table.

**Expected status column values (in order):**
- "Waiting to start" (queued)
- "Applying changes" (processing)
- "Completed" (completed)

These labels come from `translateBulkEditStatus()` at [errors.ts:861-867](apps/web/src/lib/errors.ts:861).

**Pass evidence:** Screenshot(s) showing at least "Waiting to start" and "Completed" in the status column.

---

### Test 5.2: UI shows "Completed with errors"

**What:** Partial failure renders the correct label.

**Steps:**
1. Trigger a partial failure scenario (Test 3.1).
2. Check the operations table.

**Expected:** Status column shows "Completed with errors" for that operation.

**Pass evidence:** Screenshot of the row with "Completed with errors".

---

### Test 5.3: Browser refresh shows backend truth

**What:** After a full page refresh, the operations table shows the latest backend state (not stale client state).

**Steps:**
1. Submit a bulk edit. Note the operation ID.
2. Wait for it to complete.
3. Hard refresh the page (Ctrl+Shift+R).
4. Verify the operation row shows `Completed` with correct applied/failed counts.

**Pass evidence:** Screenshot after hard refresh matching the API response from Test 2.2.

---

## Phase 6: Rollback Plan

### 6.1: Code rollback

Revert the branch (2 commits). The code change is backwards-compatible:
- Old frontend status values (`processing`, `completed`, `failed`) remain valid
- Queue handler registration in `onModuleInit` simply won't exist
- `apply()` will revert to synchronous inline processing

```bash
git revert <commit-hash-1> <commit-hash-2>
```

### 6.2: Database rollback — enum values

**Postgres limitation:** `ALTER TYPE ... DROP VALUE` does not exist. Enum values cannot be removed once committed.

**Mitigation:** The new values (`queued`, `completed_with_errors`) are harmless if unused:
- `queued` — if reverted code never writes it, no rows will have this status. The column default reverts to `processing` via the Prisma schema revert.
- `completed_with_errors` — same: no code path writes it after revert.

**If a clean rollback is required (rare, destructive):**
```sql
-- 1. Update any rows that somehow got the new values
UPDATE "BulkEditOperation" SET status = 'processing' WHERE status = 'queued';
UPDATE "BulkEditOperation" SET status = 'completed' WHERE status = 'completed_with_errors';

-- 2. Reset the column default
ALTER TABLE "BulkEditOperation" ALTER COLUMN "status" SET DEFAULT 'processing';

-- 3. Recreate the enum WITHOUT the new values (requires column rebuild)
-- WARNING: This is destructive. Only do this if absolutely necessary.
ALTER TABLE "BulkEditOperation" ALTER COLUMN "status" TYPE TEXT;
DROP TYPE "BulkEditOperationStatus";
CREATE TYPE "BulkEditOperationStatus" AS ENUM ('processing', 'completed', 'failed');
ALTER TABLE "BulkEditOperation"
  ALTER COLUMN "status" TYPE "BulkEditOperationStatus"
  USING status::"BulkEditOperationStatus";
ALTER TABLE "BulkEditOperation"
  ALTER COLUMN "status" SET DEFAULT 'processing';

-- 4. Mark the migrations as rolled back in _prisma_migrations
DELETE FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260701000001_bulk_edit_queued_status',
  '20260701000002_bulk_edit_default_queued'
);
```

**Recommendation:** Prefer leaving the unused enum values in place (step 1-2 only). The full enum rebuild (step 3) is high-risk and should only be done during a maintenance window.

### 6.3: In-flight operations during rollback

If reverting while operations are in `queued` or `processing` state:

```sql
-- Find any in-flight operations
SELECT id, status, "requestedCount", "appliedCount"
FROM "BulkEditOperation"
WHERE status IN ('queued', 'processing');

-- Mark them as failed so they don't hang forever
UPDATE "BulkEditOperation"
SET status = 'failed'
WHERE status IN ('queued', 'processing');
```

---

## Summary

| # | Test | Phase | Pass? |
|---|------|-------|-------|
| 1.1 | prisma migrate deploy | DB Migration | [ ] |
| 1.2 | Enum values in DB | DB Migration | [ ] |
| 1.3 | Column default is queued | DB Migration | [ ] |
| 2.1 | Apply returns queued immediately | API | [ ] |
| 2.2 | BullMQ processes the job | API | [ ] |
| 2.3 | Status transitions in order | API | [ ] |
| 3.1 | Partial failure -> completed_with_errors | Partial Failure | [ ] |
| 3.2 | All fail -> failed | Partial Failure | [ ] |
| 4.1 | Retry is idempotent (no duplicates) | Idempotency | [ ] |
| 4.2 | Resume after crash | Idempotency | [ ] |
| 4.3 | Terminal operations skipped | Idempotency | [ ] |
| 5.1 | UI shows status progression | Browser | [ ] |
| 5.2 | UI shows "Completed with errors" | Browser | [ ] |
| 5.3 | Browser refresh = backend truth | Browser | [ ] |

**After all tests pass:** PR #369 can be marked Ready for Review.
