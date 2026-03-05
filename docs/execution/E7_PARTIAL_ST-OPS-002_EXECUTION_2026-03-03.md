# E7 Partial Execution Record (ST-OPS-002)

- Date: 2026-03-03
- Scope: `E7 Runtime Reliability and Ops Gates` (partial)
- Story completed in this pass: `ST-OPS-002 Worker backpressure and limits`
- Source backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`

## ST-OPS-002: Worker backpressure and limits
- PRD mapping: `NFR-004`
- Status: Complete
- Acceptance evidence:
1. Queue backpressure model implemented in [queue.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\queue\queue.service.ts):
   - per-lane (connector) policies (`concurrency`, `minIntervalMs`),
   - rate-limit detection and storm thresholding,
   - automatic lane pause/circuit-open behavior after repeated rate-limit errors.
2. Queue metrics exposure implemented via `QueueService.getMetrics()` and included in health response in [app.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\common\app.controller.ts).
3. Marketplace connector worker registration now uses queue backpressure policies in [marketplace.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\marketplace\marketplace.service.ts):
   - lane by connector slug (`amazon`, `flipkart`, `meesho`),
   - per-connector throttling with stricter Amazon interval,
   - circuit-open warning logging.
4. Marketplace module wiring updated for queue dependency in [marketplace.module.ts](C:\Users\Om Computers\PIM1\apps\api\src\marketplace\marketplace.module.ts).
5. Integration proof for concurrency/rate-limit pause behavior in [worker-backpressure.test.cjs](C:\Users\Om Computers\PIM1\apps\api\test\integration\worker-backpressure.test.cjs).

## Gate Checks (this pass)
- `npm run test:integration:worker-backpressure` -> Pass
- `npm run test:integration:auth-revocation` -> Pass
- `npm run test:integration:rls-isolation` -> Pass
- `npm run lint --workspace @pim1/api` -> Pass
- `npm run build --workspace @pim1/api` -> Pass
- `npm run lint --workspace @pim1/web` -> Pass
- `npm run build --workspace @pim1/web` -> Pass
- `npm run guard:unsafe-raw` -> Pass

## Remaining E7 stories
- `ST-OPS-005` Staging-only gate sign-off -> Pending
