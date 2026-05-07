---
title: Vexa PIM Large Import MVP Follow-Up PR Summary
type: pr-summary
date: 2026-05-07
head_sha: 0d16ce6
owner: product + cto
---

## Summary

This follow-up PR package hardens and operationalizes Vexa PIM's Large Import Mode MVP after the upstream `BulkImportRun` implementation landed.

It does not broaden scope into `50k`, spreadsheet import, or enterprise-scale claims.

It closes the main gaps that still mattered for controlled-pilot and early SMB / mid-market use:

- large CSV imports are now actually wired through staged preflight and parent-run handling
- large-run processing now follows standard import policy and redaction expectations more closely
- browser proof exists for the visible large-import parent-run workflow
- product, admin, and execution docs now state the real CSV-only `30,000`-row boundary

## Commit chain in scope

- `5615cf3` `fix(imports): wire large-run workflow and policy parity`
- `e808d93` `test(imports): add browser proof and align large-import docs`
- `c5aa007` `docs(imports): add large-import rollout guidance`
- `0d16ce6` `docs(imports): correct admin import setup limits`

## What changed

### Product/API behavior

- Large CSV uploads now route through staged preflight and real parent-run handling instead of silently staying on the legacy standard-job path.
- Standard `<=10k` imports remain intact.
- Large-run row visibility and combined error-report behavior now align more closely with standard import redaction and policy handling.
- Large-run status aggregation is safer when child jobs fail.
- Large-run upload DTO validation is explicit and no longer depends on permissive body parsing behavior.

### Browser proof

- Added targeted Playwright proof for the large-import parent-run experience.
- Fixed stale helper/branding issues in the pending-feedback import proof so current import UX evidence is trustworthy again.
- Hardened local Playwright API startup for this repo's staged import workflows.

### Documentation and rollout truth

- Added an operator runbook for Large Import Mode MVP.
- Updated release notes, current-state notes, rollout checklist, risk register, user guides, and admin checklist so they all reflect the same import boundary:
  - standard mode: CSV/JSON up to `10,000` rows
  - large mode: CSV only from `10,001` to `30,000` rows
  - files above `30,000` blocked in MVP
  - no `.xlsx` / `.xls`

## Validation summary

Passing during this follow-up slice:

- `npm run prisma:generate`
- `npm run lint --workspace @pim1/api`
- `npm run build --workspace @pim1/api`
- `npm run build --workspace @pim1/web`
- `npm run test --workspace @pim1/web`
- `npm run guard:sensitive-gets`
- targeted Playwright:
  - `apps/web/test/e2e/pending-feedback.spec.js`
  - `apps/web/test/e2e/large-import-mode.spec.js`

## Safe product claim

`Vexa supports single-file CSV imports up to 30,000 rows using Large Import Mode. Large files are processed in safe internal background batches with one parent progress view, unified repair rows, and one combined error report.`

## Claims to avoid

- `50k import support`
- `enterprise-scale import`
- `unlimited imports`
- `large XLSX support`
- `direct browser-to-R2 upload`

## Reviewer focus

1. Large CSV imports should now route through staged preflight and parent-run handling instead of falling back to the legacy standard job path.
2. Standard `<=10k` import behavior should remain unchanged.
3. The visible product and ops docs should all agree on the same `30,000`-row CSV-only boundary.
4. Browser proof should reflect the real large-import parent-run experience rather than string-only route assertions.
