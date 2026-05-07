# Vexa PIM Large Import Mode Operator Guide

- Last updated: 2026-05-07
- Audience: operators, pilot support, product, CTO, and release reviewers
- Scope: current Large Import Mode MVP only

## 1. What Large Import Mode Is

Large Import Mode is Vexa's staged CSV import path for files that exceed the standard import size but still fit the current MVP boundary.

Use it for:
- CSV files with `10,001` to `30,000` data rows
- one parent import run
- one unified repair/result workflow
- one combined error report

Do not use it to claim:
- support above `30,000` rows
- `.xlsx` or `.xls` import support
- direct browser-to-object-storage upload
- enterprise-scale or unlimited imports

## 2. Current Supported Boundaries

### Standard import mode
- file types: CSV and JSON
- row ceiling: `10,000`
- processing model: standard bulk import job flow

### Large Import Mode MVP
- file type: CSV only
- row range: `10,001` to `30,000`
- processing model: staged upload, server-side preflight, internal `1,000`-row background batches
- visible UX: one parent import run, one progress view, one repair queue, one combined error report

### Explicitly blocked in MVP
- CSV files above `30,000` rows
- JSON large-import mode
- spreadsheet formats such as `.xlsx` and `.xls`

## 3. Operator Workflow

1. Open `Operations -> Imports`.
2. Upload a CSV file and choose the target category.
3. Run preflight validation.
4. If the file is above `10,000` rows and at or below `30,000`, Vexa enables `Large file mode`.
5. Review:
   - total rows
   - blocking issues
   - warnings
   - estimated internal batch count
6. If preflight is ready, start the import run.
7. Monitor the parent run from the imports workspace.
8. Use the unified row results and repair surface if rows fail.
9. Download the combined error report when needed.

## 4. Expected User-Facing Messaging

When large mode is active, operators should see language equivalent to:

- `Large file mode enabled. Vexa will process this file in safe background batches.`
- `Files exceeding 30,000 rows cannot be imported. Upload a smaller file or split the file before retrying.`

If preflight is blocked, operators should stay at the run level and not need to manage internal child jobs directly.

## 5. Support and Triage Guidance

### If preflight is blocked
Check for:
- missing required canonical columns
- malformed CSV structure
- category mismatch issues
- duplicate `skuCode` values inside the uploaded file, if `skuCode` is provided
- `skuCode` collisions with existing tenant variants, if `skuCode` is provided
- row count above `30,000`

### If operators ask about chunk size
Explain:
- standard mode still exposes user-entered chunk size
- large mode does not use operator-managed chunk size
- Vexa internally uses fixed `1,000`-row background batches in the MVP

### If operators ask why they cannot see child jobs
Explain:
- child batches are intentionally internal
- the operator workflow is the parent run
- repair, progress, and error reporting are unified at the run level

## 6. Safe Commercial Wording

Safe claim:

`Vexa supports single-file CSV imports up to 30,000 rows using Large Import Mode. Large files are processed in safe internal background batches with one parent progress view, unified repair rows, and one combined error report.`

Avoid:
- `50k import support`
- `enterprise-scale import`
- `unlimited imports`
- `large XLSX support`
- `direct browser-to-R2 upload`

## 7. Validation Evidence

Current local/browser proof for the MVP includes:
- API lint/build green
- web build/test green
- targeted Playwright proof for:
  - pending feedback import flow
  - large import mode parent-run guidance

This evidence supports controlled pilot and early SMB / mid-market claim boundaries only. Enterprise-readiness remains future-scope.
