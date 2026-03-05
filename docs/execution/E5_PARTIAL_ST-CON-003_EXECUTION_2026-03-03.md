# E5 Partial Execution Record (ST-CON-003)

- Date: 2026-03-03
- Scope: `E5 Connector Framework and Submission` (partial)
- Story completed in this pass: `ST-CON-003 Webhook dedupe scope`
- Source backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`

## ST-CON-003: Webhook dedupe scope
- PRD mapping: `CR-002`
- Status: Complete
- Acceptance evidence:
1. Connector webhook table constraint is installation scoped in [connector-installer.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\connector-installer\connector-installer.service.ts):
   - `CONSTRAINT connector_webhook_installation_event_unique UNIQUE (installation_id, external_event_id)`
   - no global uniqueness on `external_event_id`.
2. Integration proof added in [webhook-dedupe-scope.test.cjs](C:\Users\Om Computers\PIM1\apps\api\test\integration\webhook-dedupe-scope.test.cjs):
   - same `external_event_id` across two different installations is accepted,
   - duplicate `external_event_id` for the same installation is rejected.

## Gate Checks (this pass)
- `npm run test:integration:webhook-dedupe-scope` -> Pass
- `npm run guard:unsafe-raw` -> Pass
- `npm run lint --workspace @pim1/api` -> Pass
- `npm run build --workspace @pim1/api` -> Pass
- `npm run lint --workspace @pim1/web` -> Pass
- `npm run build --workspace @pim1/web` -> Pass

## Remaining E5 stories
- `ST-CON-004` Structured connector errors end-to-end -> Pending
- `ST-CON-005` Payload snapshot policy for submissions -> Pending
