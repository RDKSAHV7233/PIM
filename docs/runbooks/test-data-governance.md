# Test Data Governance Runbook

## Purpose
Keep seller-facing workflows free from smoke/test artifacts while preserving safe maintenance controls for engineering.

## Scope
- UI default filtering for test-pattern data.
- Tenant-scoped purge workflow for test artifacts.
- Operator checklist for dry-run and execute modes.

## Test Data Detection Rules
- Source of truth: [test-data-filter.ts](C:\Users\Om Computers\PIM1\apps\web\src\lib\test-data-filter.ts)
- Prefix-based matching is used (`Phase2`, `Phase3`, `Smoke`, `RBAC`, `Benchmark`, etc.).

## Seller-Facing Default Behavior
- Source of truth: [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx)
- `hideTestData` resolves to `true` when query param is absent.
- Filter is applied to:
1. Product list.
2. Category list/dropdowns.
3. Bulk import templates and jobs.
4. Derived summary counts.

## Purge Workflow
- Tool: [purge-test-data.cjs](C:\Users\Om Computers\PIM1\tools\dev\purge-test-data.cjs)
- NPM wrappers:
1. Dry-run: `npm run data:purge:test:dry`
2. Execute: `npm run data:purge:test`

### Tenant Isolation
- Default tenant: `default`
- Explicit tenant targeting:
  - Dry-run with tenant: `node tools/dev/purge-test-data.cjs --tenant=<tenantKey>`
  - Execute with tenant: `node tools/dev/purge-test-data.cjs --tenant=<tenantKey> --execute`

## Required Operating Steps
1. Run dry-run first and capture JSON summary.
2. Verify matched counts are only expected test artifacts.
3. Run execute mode only after dry-run verification.
4. Re-run dry-run and confirm matched counts are zero.
5. Record execution evidence in `docs/execution/`.

## Safety Notes
- Purge script deletes across linked entities (products, categories, variants, import/edit artifacts, export jobs, related media assets).
- Never run execute mode against the wrong tenant key.
- For production runs, take a backup before execute mode.
