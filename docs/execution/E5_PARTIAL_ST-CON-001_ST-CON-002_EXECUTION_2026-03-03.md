# E5 Partial Execution Record (ST-CON-001, ST-CON-002)

- Date: 2026-03-03
- Scope: `E5 Connector Framework and Submission` (partial)
- Stories completed in this pass:
  - `ST-CON-001 Capability-guarded orchestration paths`
  - `ST-CON-002 Stable idempotency key semantics`
- Source backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`

## ST-CON-001: Capability-guarded orchestration paths
- PRD mapping: `FR-009, CR-004, CR-005`
- Status: Complete
- Acceptance evidence:
1. Publish path remains capability-guarded in [connector-framework.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-framework\connector-framework.service.ts):
   - throws `CapabilityNotSupportedError` when `installation.capabilities` does not include `PUBLISH`,
   - throws the same deterministic error if connector implementation has no `publishProduct`.
2. Explicit export-only orchestration path implemented via `submitOrExport()` and `completeExportOnly()` in [connector-framework.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-framework\connector-framework.service.ts), returning an explicit `{ mode: "export_only" }` completion result for export-only connectors.
3. Deterministic unsupported-capability behavior verified in [connector-capability-orchestration.test.cjs](C:\Users\Om Computers\PIM1\apps\api\test\integration\connector-capability-orchestration.test.cjs).

## ST-CON-002: Stable idempotency key semantics
- PRD mapping: `CR-001`
- Status: Complete
- Acceptance evidence:
1. Stable idempotency key helper implemented in [connector-framework.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-framework\connector-framework.service.ts):
   - `buildIdempotencyKey(jobId, operation)` generates `${jobId}:${operation}`.
2. Submission attempt recording implemented with DB upsert in [connector-framework.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-framework\connector-framework.service.ts):
   - key is stable across retries,
   - `attempt_number` increments independently on conflict,
   - duplicate retries do not create duplicate rows.
3. Marketplace processing now records connector submission attempts through framework integration in [marketplace.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\marketplace\marketplace.service.ts) with channel-to-connector slug mapping and installation-aware guard.
4. End-to-end retry semantics verified in [connector-idempotency-semantics.test.cjs](C:\Users\Om Computers\PIM1\apps\api\test\integration\connector-idempotency-semantics.test.cjs):
   - single row for stable key `${jobId}:PUBLISH`,
   - attempt number increments across retries.

## Gate Checks (this pass)
- `npm run test:integration:connector-capability-orchestration` -> Pass
- `npm run test:integration:connector-idempotency-semantics` -> Pass
- `npm run guard:unsafe-raw` -> Pass
- `npm run lint --workspace @pim1/api` -> Pass
- `npm run build --workspace @pim1/api` -> Pass
- `npm run lint --workspace @pim1/web` -> Pass
- `npm run build --workspace @pim1/web` -> Pass

## Remaining E5 stories
- `ST-CON-003` Webhook dedupe scope -> Pending
- `ST-CON-004` Structured connector errors end-to-end -> Pending
- `ST-CON-005` Payload snapshot policy for submissions -> Pending
