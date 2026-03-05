# Sprint Plan - Phase 4 Closeout

Plan date: 2026-02-28  
Release target: `R-MVP-2026-03`  
Cadence: 2-week sprint

## Sprint Calendar

## Sprint `S4-CLOSEOUT-1` (2026-03-02 to 2026-03-13)
Sprint goal:
- Close functional gaps for import file support and repair export.
- Produce objective 1,000-SKU benchmark evidence.

Committed items:
- EXE-P4-001 (`.xlsx/.xls` upload + parse)
- EXE-P4-002 (large-file safeguards and processing metrics)
- EXE-P4-003 (error report export)
- EXE-P4-006 (1,000-SKU benchmark report)
- EXE-BUG-001 (runtime stability runbook)

Task breakdown:
| Task ID | Parent Item | Task | Owner | Estimate | Dependency | Target Date |
|---|---|---|---|---|---|---|
| T-S1-01 | EXE-P4-001 | Add XLSX parser service and file-type validation | EL | 2 d | None | 2026-03-04 |
| T-S1-02 | EXE-P4-001 | Add upload UX for csv/xlsx/xls with mapping preview | EL | 2 d | T-S1-01 | 2026-03-06 |
| T-S1-03 | EXE-P4-002 | Add import size guardrails and checkpoint metrics | EL | 2 d | T-S1-01 | 2026-03-07 |
| T-S1-04 | EXE-P4-003 | Add failed-row CSV export API + UI action | EL | 1 d | None | 2026-03-07 |
| T-S1-05 | EXE-P4-006 | Run 1,000-SKU benchmark + publish report artifact | QA | 2 d | T-S1-02,T-S1-03 | 2026-03-11 |
| T-S1-06 | EXE-BUG-001 | Document and validate web runtime recovery runbook | EL | 1 d | None | 2026-03-12 |

Exit checks:
- Functional demo for xlsx/xls upload and repair export.
- Benchmark report attached in weekly governance.
- Smoke + lint + build checks green.

## Sprint `S4-CLOSEOUT-2` (2026-03-16 to 2026-03-27)
Sprint goal:
- Close repeat-import template features and MVP non-functional baselines.
- Complete gate memo and release readiness decision.

Committed items:
- EXE-P4-004 (template save/load per tenant)
- EXE-P4-005 (template versioning + compatibility warnings)
- EXE-X-001 (RBAC baseline)
- EXE-X-002 (audit logging baseline)
- EXE-P1-005 (concurrent edit conflict protection)
- EXE-P4-007 (pilot workflow + gate memo)

Task breakdown:
| Task ID | Parent Item | Task | Owner | Estimate | Dependency | Target Date |
|---|---|---|---|---|---|---|
| T-S2-01 | EXE-P4-004 | Add template persistence model + CRUD endpoints | EL | 2 d | None | 2026-03-18 |
| T-S2-02 | EXE-P4-004 | Add template save/load UX in import flow | EL | 2 d | T-S2-01 | 2026-03-20 |
| T-S2-03 | EXE-P4-005 | Add template version and compatibility warning checks | EL | 2 d | T-S2-01 | 2026-03-21 |
| T-S2-04 | EXE-X-001 | Enforce admin/editor/viewer role controls in API/UI | EL | 3 d | None | 2026-03-24 |
| T-S2-05 | EXE-X-002 | Expand audit events for catalog/bulk operations | EL | 2 d | None | 2026-03-24 |
| T-S2-06 | EXE-P1-005 | Add optimistic conflict/version check + UI conflict path | EL | 2 d | None | 2026-03-25 |
| T-S2-07 | EXE-P4-007 | Pilot workflow evidence + release gate memo | PO | 1 d | T-S2-01..T-S2-06 | 2026-03-27 |

Exit checks:
- All MVP `P0` backlog items marked done in execution board.
- Gate checklist reviewed with PO/EL/QA.
- Release recommendation documented (`Go` or `No-Go`).

## Test and Readiness Matrix

Per committed item, minimum evidence:
- Unit or service-level tests for new logic
- Smoke test path for end-to-end workflow
- Updated docs/status entries
- Demo notes in sprint review

Release readiness blockers:
- Any open `P0` backlog item
- Failed benchmark thresholds for Phase 4 KPI
- Unresolved security or audit baseline gaps
