# E5 Partial Execution Record (ST-CON-004)

- Date: 2026-03-03
- Scope: `E5 Connector Framework and Submission` (partial)
- Story completed in this pass: `ST-CON-004 Structured connector errors end-to-end`
- Source backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`

## ST-CON-004: Structured connector errors end-to-end
- PRD mapping: `CR-003`
- Status: Complete
- Acceptance evidence:
1. Marketplace channel issue shape is aligned to connector issue contract in [marketplace.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\marketplace\marketplace.service.ts):
   - `code`,
   - `fieldPath`,
   - `severity`,
   - `sellerMessage`.
   A compatibility `message` field is still returned for existing UI consumers.
2. Connector submission persistence stores structured channel errors in [marketplace.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\marketplace\marketplace.service.ts) via `recordSubmissionAttempt(...)`, preserving `sellerMessage` in `connector_submissions.channel_errors`.
3. Web client API contract updated in [api.ts](C:\Users\Om Computers\PIM1\apps\web\src\lib\api.ts) so simulation issues carry `sellerMessage`.
4. End-to-end validation in [connector-issue-contract.test.cjs](C:\Users\Om Computers\PIM1\apps\api\test\integration\connector-issue-contract.test.cjs) verifies:
   - API simulation response issue objects include all structured fields,
   - persisted `connector_submissions.channel_errors` include the same structured shape.

## Gate Checks (this pass)
- `npm run test:integration:connector-issue-contract` -> Pass
- `npm run guard:unsafe-raw` -> Pass
- `npm run lint --workspace @pim1/api` -> Pass
- `npm run build --workspace @pim1/api` -> Pass
- `npm run lint --workspace @pim1/web` -> Pass
- `npm run build --workspace @pim1/web` -> Pass

## Remaining E5 stories
- `ST-CON-005` Payload snapshot policy for submissions -> Pending
