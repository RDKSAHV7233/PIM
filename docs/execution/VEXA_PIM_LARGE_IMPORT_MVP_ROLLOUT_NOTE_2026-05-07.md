# Vexa PIM Large Import Mode MVP Rollout Note

- Date: 2026-05-07
- Audience: product, CTO, support, operations, reviewer, and controlled-pilot stakeholders
- Scope: current Large Import Mode MVP only

## Summary

Vexa now supports a staged large-import workflow for single-file CSV imports above the standard import ceiling and up to the current MVP limit.

This rollout note is intentionally bounded. It documents what is safe to say now, what operators can rely on, and what remains out of scope.

## What is now available

### Standard import mode
- file types: CSV and JSON
- row ceiling: `10,000`
- workflow: existing standard bulk import job path

### Large Import Mode MVP
- file type: CSV only
- row range: `10,001` to `30,000`
- processing model:
  - staged upload
  - server-side preflight
  - internal `1,000`-row background batches
  - one parent progress experience
  - unified repair rows
  - one combined error report

## What changed in the follow-up hardening slice

- large CSV imports now follow staged preflight and parent-run handling in the visible product flow
- standard `<=10k` imports remain on the stable legacy job path
- large-run rows and combined error reporting now better align with standard import policy/redaction expectations
- parent-run aggregation is safer when child jobs fail
- browser proof exists for the visible parent-run large-import workflow
- product/admin/execution docs now state the same current boundary

## Safe commercial wording

Use:

`Vexa supports single-file CSV imports up to 30,000 rows using Large Import Mode. Large files are processed in safe internal background batches with one parent progress view, unified repair rows, and one combined error report.`

Avoid:

- `50k import support`
- `enterprise-scale import`
- `unlimited imports`
- `large XLSX support`
- `direct browser-to-R2 upload`

## Operator guidance

- if the file is `10,000` rows or fewer, it stays on the standard import path
- if the CSV is above `10,000` and at or below `30,000`, Vexa enables Large Import Mode automatically
- if the CSV exceeds `30,000`, it is blocked in the MVP
- operators should manage the parent run, not the internal child batches

See:

- `docs/runbooks/large-import-mode-operator-guide.md`

## Validation evidence in this repo state

- API lint/build: green
- web build/test: green
- targeted Playwright:
  - `pending-feedback.spec.js`: green
  - `large-import-mode.spec.js`: green

## Remaining boundary

This rollout note supports controlled pilot and early SMB / mid-market usage only.

It does not support:
- broadening the row ceiling beyond `30,000`
- spreadsheet-format imports
- enterprise-scale import marketing
- new infrastructure claims beyond the current staged-upload MVP
