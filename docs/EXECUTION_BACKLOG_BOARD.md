# Execution Backlog Board (MVP Closeout)

Purpose:
- Single execution board for product + project backlog items that are active for MVP gate closure.

Status values:
- `Ready`: refined and unblocked for sprint pull.
- `In Progress`: currently being implemented.
- `Blocked`: external dependency or decision needed.
- `Done`: implemented and validated.

Priority legend:
- `P0`: required for MVP gate.
- `P1`: post-MVP stabilization.

Current release target:
- `R-MVP-2026-03` (Phase 4 gate closeout)

## Active Backlog

| ID | Source | Title | Priority | Business Value | Status | Owner | Team | Estimate | Dependencies | Target Sprint | Target Release | Acceptance/Test Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EXE-P4-001 | P4-US-001 | Add `.xlsx/.xls` upload + parse in bulk import UI/API | P0 | Unlock Excel-first onboarding and reduce seller friction | Done | EL | Web+API | 8 SP | None | S4-CLOSEOUT-1 | R-MVP-2026-03 | Accept xlsx/xls/csv, parse >=1000 rows, API + UI smoke pass |
| EXE-P4-002 | P4-US-001/P4-US-002 | Add large-file safeguards (size guard, chunk checkpoints, retry metrics) | P0 | Prevent import instability at scale | Done | EL | API | 5 SP | EXE-P4-001 | S4-CLOSEOUT-1 | R-MVP-2026-03 | Source payload size guard enforced; checkpoint/retry metrics returned in API and visible in jobs table |
| EXE-P4-003 | P4-US-006 | Export error report for failed import rows (CSV download) | P0 | Reduce repair cycle time and operational rework | Done | EL | API+Web | 3 SP | None | S4-CLOSEOUT-1 | R-MVP-2026-03 | Export includes row/column/reason; QA verifies sample file |
| EXE-P4-004 | P4-US-004 | Bulk import template save/load per tenant | P0 | Faster repeat uploads for recurring sellers | Done | EL | API+Web | 8 SP | EXE-P4-001 | S4-CLOSEOUT-2 | R-MVP-2026-03 | Template persistence with tenant/category scope and load-to-import-form workflow is live |
| EXE-P4-005 | P4-US-004 | Template versioning + compatibility warnings | P0 | Prevent template drift and wrong-field imports | Done | EL | API+Web | 5 SP | EXE-P4-004 | S4-CLOSEOUT-2 | R-MVP-2026-03 | Version auto-increments by template name; compatibility warnings shown when category schema changes |
| EXE-P4-006 | Phase 4 Gate KPI | Produce 1,000-SKU import benchmark report | P0 | Objective MVP gate evidence | Done | QA | QA+API | 3 SP | EXE-P4-001, EXE-P4-002 | S4-CLOSEOUT-1 | R-MVP-2026-03 | Benchmark run: 1000/1000 success, 100% success rate, ~53.78 rows/s throughput, 0 retries/failures |
| EXE-P4-007 | Phase 4 Gate KPI | Pilot workflow validation and gate memo | P0 | Final go/no-go input for MVP release | Done | PO | PO+PM+QA | 2 SP | EXE-P4-003, EXE-P4-006 | S4-CLOSEOUT-2 | R-MVP-2026-03 | Pilot evidence and gate memo published (`docs/PHASE4_PILOT_WORKFLOW_VALIDATION_2026-02-28.md`, `docs/PHASE4_GATE_MEMO_2026-02-28.md`) |
| EXE-X-001 | X-US-001 | RBAC baseline (admin/editor/viewer) in API/UI | P0 | Access control baseline for production readiness | Done | EL | API+Web | 8 SP | None | S4-CLOSEOUT-2 | R-MVP-2026-03 | API+UI RBAC enforced and validated (`docs/EXE-X-001_RBAC_EVIDENCE_2026-02-28.md`) |
| EXE-X-002 | X-US-002 | Audit log baseline for CRUD + bulk operations | P0 | Compliance and incident traceability | Done | EL | API | 5 SP | None | S4-CLOSEOUT-2 | R-MVP-2026-03 | Baseline audit capture validated with evidence (`docs/EXE-X-002_AUDIT_EVIDENCE_2026-02-28.md`) |
| EXE-P1-005 | P1-US-005 | Add concurrent edit conflict protection for products | P0 | Prevent silent overwrite and data loss | Done | EL | API+Web | 5 SP | None | S4-CLOSEOUT-2 | R-MVP-2026-03 | Version check conflict path + deterministic UI error validated (`docs/EXE-P1-005_CONCURRENCY_EVIDENCE_2026-02-28.md`) |
| EXE-BUG-001 | Runtime Stability | Stabilize web dev runtime (`.next` corruption/port conflict runbook) | P1 | Reduce developer downtime and false alarms | In Progress | EL | Web | 2 SP | None | S4-CLOSEOUT-1 | R-MVP-2026-03 | Runbook documented and validated |

## Board Rules

Every item must include:
- `Owner`
- `Estimate`
- `Dependencies`
- `Target Sprint`
- `Target Release`
- Acceptance/Test notes

Exit rule for MVP gate:
- All `P0` items above must be `Done` with test evidence linked in status review.
