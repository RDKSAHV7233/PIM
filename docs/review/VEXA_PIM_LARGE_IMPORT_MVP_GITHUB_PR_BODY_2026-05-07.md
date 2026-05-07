## Summary

This PR hardens and operationalizes Vexa PIM's Large Import Mode MVP after the upstream `BulkImportRun` implementation landed.

It keeps the stable `<=10k` standard import path intact while making the staged large-import path reviewable, browser-proven, and better aligned with policy, repair, and documentation expectations.

This PR does **not** broaden scope into `50k`, spreadsheet imports, direct browser-to-object-storage upload, or enterprise-scale import claims.

## Scope

### Product and API behavior

- wire large CSV imports through staged preflight and parent-run handling
- keep standard `<=10k` imports on the existing `/bulk-import/jobs` path
- improve large-run policy/redaction parity with standard import jobs
- make parent-run aggregation safer when child jobs fail
- harden large-run upload DTO validation

### Browser proof

- add targeted Playwright proof for large import mode parent-run behavior
- repair stale pending-feedback import proof helpers/branding
- improve local Playwright startup reliability for this repo's staged-import workflows

### Documentation and rollout truth

- add an operator runbook for Large Import Mode MVP
- update release notes, current-state notes, rollout checklist, risk register, user guides, and admin checklist
- align all active docs to the same boundary:
  - standard mode: CSV/JSON up to `10,000` rows
  - large mode: CSV only from `10,001` to `30,000` rows
  - files above `30,000` blocked in MVP
  - no `.xlsx` / `.xls`

## Commit chain in scope

- `5615cf3` `fix(imports): wire large-run workflow and policy parity`
- `e808d93` `test(imports): add browser proof and align large-import docs`
- `c5aa007` `docs(imports): add large-import rollout guidance`
- `0d16ce6` `docs(imports): correct admin import setup limits`
- `3e75fe3` `docs(review): add large-import mvp handoff package`

## Validation

Passing:

- `npm run prisma:generate`
- `npm run lint --workspace @pim1/api`
- `npm run build --workspace @pim1/api`
- `npm run build --workspace @pim1/web`
- `npm run test --workspace @pim1/web`
- `npm run guard:sensitive-gets`
- targeted Playwright:
  - `apps/web/test/e2e/pending-feedback.spec.js`
  - `apps/web/test/e2e/large-import-mode.spec.js`

## Safe claim boundary

Safe claim:

`Vexa supports single-file CSV imports up to 30,000 rows using Large Import Mode. Large files are processed in safe internal background batches with one parent progress view, unified repair rows, and one combined error report.`

Do not claim:

- `50k import support`
- `enterprise-scale import`
- `unlimited imports`
- `large XLSX support`
- `direct browser-to-R2 upload`

## Reviewer focus

1. Large CSV imports should now route through staged preflight and parent-run handling instead of falling back to the legacy standard job path.
2. Standard `<=10k` import behavior should remain unchanged.
3. Large-run rows, error reporting, and parent status should follow the same safety expectations as standard import jobs.
4. The active product/admin/execution docs should all agree on the same current `30,000`-row CSV-only boundary.

## Local-only noise intentionally excluded

Not part of this PR:

- `package-lock.json`
- `tmp-prisma-check.ts`
