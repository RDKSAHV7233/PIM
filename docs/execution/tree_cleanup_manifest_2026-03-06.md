# Tree Cleanup Manifest � 2026-03-06

## Scope
Phase 2 cleanup after publishability and docs/bootstrap integrity commits.

## Active (no move)
- `scripts/staging-postdeploy-check.cjs`
- `scripts/run-increment-gates.cjs`
- `packages/db/prisma/migrations/20260305222000_workflow_status_states/migration.sql`
- `apps/api/test/integration/product-workflow-transitions.test.cjs`
- `packages/db/prisma/schema.prisma`
- `.github/workflows/deploy-staging.yml`
- `docs/execution/INCREMENT_STATE.json`
- Canonical gate/rollout evidence referenced by increment state

## Move to docs/references/pim1
- None in this pass (deferred to avoid mixing with active docs edits).

## Move to unused/archive
- `docs/ports/orbit-TEJ PIM-transfer-2026-03-06/**` -> `unused/archive/ports/orbit-TEJ PIM-transfer-2026-03-06/**`
- `qa-ui-crawl.json` -> `unused/archive/temp/qa-ui-crawl.json`

## Generated artifacts ignore hardening
- Added `.next-dev/` to `.gitignore`
- Added `*.tsbuildinfo` to `.gitignore`
