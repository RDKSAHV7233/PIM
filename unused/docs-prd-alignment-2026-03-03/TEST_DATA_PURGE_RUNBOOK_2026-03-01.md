# Test Data Purge Runbook (2026-03-01)

## Purpose
Remove legacy smoke/test artifacts from tenant `default` before real seller onboarding.

## Tooling
- Dry run: `npm run data:purge:test:dry`
- Execute: `npm run data:purge:test`
- Optional tenant override:
  - `node tools/dev/purge-test-data.cjs --tenant=default`
  - `node tools/dev/purge-test-data.cjs --tenant=default --execute`

## Safety protocol
1. Run dry-run first and review JSON counts.
2. Take DB backup/snapshot.
3. Run execute mode.
4. Re-run dry-run and verify all matched counts are zero.
5. Run smoke checks:
   - `tools/phase4/smoke-test.ps1`

## Matching rules
The purge targets names/titles with known test prefixes:
- `Phase2`, `Phase3`, `Phase4`, `Phase5`, `Phase6`, `Phase7`, `Phase8`
- `Smoke`, `RBAC`, `Concurrency`, `Audit`, `Benchmark`, `Metrics`
- `Reject Score`, `Media Smoke`, `ONDC Smoke`, `AI Smoke`
- `Pilot`, `Template`, `Version`, `Xlsx`

## Expected output
Both dry-run and execute return JSON with table-level counts and timestamp.
