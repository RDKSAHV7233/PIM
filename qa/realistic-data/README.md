# Visible QA Data Pack

Status: Canonical
Last reviewed: 2026-06-15

This folder contains the realistic synthetic QA dataset for Vexa PIM page-by-page manual testing.

## What it provides

- A visible apparel-led taxonomy for the `default` tenant
- Category-scoped attribute definitions that match current DTOs
- 16 products and 28 variants designed around catalog, quality, search, and workflow coverage
- Import artifacts:
  - `import-clean.csv`
  - `import-mixed.csv`
  - `import-large-10001.csv`
  - `large-import-plan.json`
- A cleanup-aware runtime manifest produced after seeding

## Why these names stay visible

The pack deliberately avoids title/name prefixes hidden by `apps/web/src/lib/test-data-filter.ts`, so the records remain visible in normal UI flows without forcing `hideTestData=false`.

## Commands

```bash
npm run qa:data:generate
npm run qa:data:seed
npm run qa:data:seed:ops
npm run qa:data:seed:control-plane
npm run qa:data:seed:control-plane:ops
npm run qa:data:cleanup
npm run test:qa:realistic-data-pack
```

## Ops-heavy scenarios

`npm run qa:data:seed` creates the cleanable core dataset only.

Use `npm run qa:data:seed:ops` only when you explicitly want:

- one bulk-edit operation
- one mixed import job attempt

Those records are opt-in because the current API does not expose full delete support for every operations artifact.

## DB fallback and control-plane safety

If the local API is unreachable, the seed script may fall back to direct Postgres seeding for dataset-owned records.

By default that fallback does **not**:

- reset Playwright user passwords
- rewrite the tenant billing plan
- overwrite workflow SLA defaults

Use `npm run qa:data:seed:control-plane` only when you explicitly want those shared control-plane mutations during DB fallback. To combine control-plane setup with ops-heavy artifacts, run `npm run qa:data:seed:control-plane:ops`.

## Cleanup ownership

Cleanup deletes only dataset-owned products, attribute definitions, and categories recorded in the runtime manifest.

Reused shared taxonomy rows are intentionally preserved. If category-ownership metadata is missing from an older manifest, cleanup refuses category deletion rather than guessing.
