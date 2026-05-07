## Reviewer checklist for Large Import Mode MVP follow-up

Review this change set with four questions in mind:

1. Does a CSV above `10,000` rows now enter staged preflight and the parent `BulkImportRun` workflow?
2. Does the stable `<=10k` import path still behave like the existing standard job flow?
3. Do large-run rows, error reporting, and parent status behavior follow the same safety expectations as standard import jobs?
4. Do the active product/admin/execution docs all state the same current truth:
   - CSV/JSON standard mode up to `10,000`
   - CSV-only large mode from `10,001` to `30,000`
   - `>30,000` blocked in MVP
   - no `.xlsx` / `.xls`

Suggested review order:

1. `5615cf3` `fix(imports): wire large-run workflow and policy parity`
2. `e808d93` `test(imports): add browser proof and align large-import docs`
3. `c5aa007` `docs(imports): add large-import rollout guidance`
4. `0d16ce6` `docs(imports): correct admin import setup limits`

High-signal areas:

- imports page behavior
- staged preflight / run auto-start
- large-run row and error-report handling
- Playwright proof
- release / runbook / admin checklist wording
