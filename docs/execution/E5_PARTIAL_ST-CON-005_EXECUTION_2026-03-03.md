# E5 Partial Execution Record (ST-CON-005)

- Date: 2026-03-03
- Scope: `E5 Connector Framework and Submission` (partial)
- Story completed in this pass: `ST-CON-005 Payload snapshot policy for submissions`
- Source backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`

## ST-CON-005: Payload snapshot policy for submissions
- PRD mapping: `FR-010`
- Status: Complete
- Acceptance evidence:
1. Connector submissions table bootstrap now includes `payload_snapshot_url` in [connector-installer.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-installer\connector-installer.service.ts), with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for existing databases.
2. Payload cap enforcement implemented in [connector-framework.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-framework\connector-framework.service.ts):
   - snapshot cap: `64KB`,
   - oversized payloads are written out-of-row under `storage/submissions/<tenant>/<job>-payload.json`,
   - row stores marker payload `{ truncated: true, originalSizeBytes, snapshotUrl }`,
   - `payload_snapshot_url` stores the same snapshot URL pointer.
3. Upsert path preserves both capped snapshot marker and URL pointer on retries in [connector-framework.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-framework\connector-framework.service.ts).
4. Integration proof in [connector-payload-snapshot-cap.test.cjs](C:\Users\Om Computers\PIM1\apps\api\test\integration\connector-payload-snapshot-cap.test.cjs):
   - oversized mapped payload triggers truncation marker,
   - `payload_snapshot_url` is populated,
   - local out-of-row snapshot file exists.

## Gate Checks (this pass)
- `npm run test:integration:connector-capability-orchestration` -> Pass
- `npm run test:integration:connector-idempotency-semantics` -> Pass
- `npm run test:integration:webhook-dedupe-scope` -> Pass
- `npm run test:integration:connector-issue-contract` -> Pass
- `npm run test:integration:connector-payload-snapshot-cap` -> Pass
- `npm run guard:unsafe-raw` -> Pass
- `npm run lint --workspace @pim1/api` -> Pass
- `npm run build --workspace @pim1/api` -> Pass
- `npm run lint --workspace @pim1/web` -> Pass
- `npm run build --workspace @pim1/web` -> Pass

## Remaining E5 stories
- None. E5 stories completed: ST-CON-001, ST-CON-002, ST-CON-003, ST-CON-004, ST-CON-005.
