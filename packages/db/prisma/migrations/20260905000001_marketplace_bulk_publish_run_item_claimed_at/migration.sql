-- CTO review follow-up (PR #719, 2026-09-05): a worker crash between claiming an item
-- (pending -> queued) and finishing it left that item stuck at `queued` forever, since
-- the resume query only ever looked for `pending` items. `claimedAt` lets
-- processBulkPublishRun's claim query also reclaim `queued` items whose claim has gone
-- stale, instead of abandoning them permanently.

-- AlterTable
ALTER TABLE "MarketplaceBulkPublishRunItem" ADD COLUMN "claimedAt" TIMESTAMP(3);
