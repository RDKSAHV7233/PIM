# PIM1 Single Source of Truth (SSOT)

Date: 2026-03-06  
Scope: Full PIM1 documentation governance for this repository

## 1) Canonical Rule

When two documents conflict, use this precedence order:
1. Code and schema (`src/**`, `db/01-schema.sql`, `admin-ui/src/**`)
2. Test evidence (`tests/**`)
3. Canonical domain docs listed below
4. Historical/point-in-time reports

No document may claim a capability as implemented unless it is traceable to code or tests.

## 2) Canonical Domain Documents

Use these as the only authoritative docs by domain:

- Product architecture baseline:
  - `docs/architecture/PIM1_ENTERPRISE_DOCUMENTATION_SUITE.md`
- Connector development:
  - `docs/connectors/PIM1_CONNECTOR_DEVELOPER_GUIDE_CTO_VALIDATED.md`
- Access control and auth policy:
  - `docs/access-control-matrix.md`
  - `docs/auth-access-control.md`
- Runtime status/state contracts:
  - `docs/STATUS_CONTRACT.md`
- UI behavior references:
  - `docs/user-guide/PAGE_WISE_USER_GUIDE.md`
  - `docs/user-guide/FUNCTIONALITY_WISE_USER_GUIDE.md`
- Operational controls:
  - `docs/launch-control-sheet.md`
  - `docs/process-roles-runbook.md`
  - `docs/redis-ha-failover-runbook.md`
  - `docs/dr-failover-exercise-runbook.md`
  - `docs/log-scrub-validation-runbook.md`

## 3) Pointer-Only Documents (Do Not Duplicate Contracts)

The following files are compatibility pointers and must not contain duplicate source-of-truth tables:
- `docs/connectors/PIM1_CONNECTOR_CONTRACT_UNIFIED.md`
- `docs/connectors/PIM1_CTO_PO_CONNECTOR_VALIDATION_2026-03-06.md`
- `pim1-local/codex-ui-package/API_CONTRACT_UNIFIED.md`

## 4) Validation Baseline (Required Before Claiming Updates)

Minimum validation commands:

```bash
npm run typecheck
npm test
```

Latest run snapshot (2026-03-06):
- `npm run typecheck` -> pass
- `npm test` -> pass (46/46 suites, 132/132 tests)

## 5) Change Control for Documentation

For any PIM1 doc update:
1. Update the relevant canonical domain doc.
2. If contract changes, verify matching code/tests exist.
3. Keep pointer-only docs as redirects; no copied contract tables.
4. Re-run validation baseline.
5. Record evidence in PR/commit notes.

## 6) Current Decision

PIM1 documentation is now organized under a single governance model:
- one SSOT index (`this file`),
- one canonical doc per domain,
- pointer-only compatibility docs for legacy locations.
