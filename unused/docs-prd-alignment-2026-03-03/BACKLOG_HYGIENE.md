# Backlog Hygiene Standard

Purpose:
- Keep product/project backlogs current, non-duplicative, and execution-ready.

Cadence:
- Weekly backlog hygiene review (30 minutes, before governance review).
- Sprint planning entry check (Definition of Ready).
- Sprint close check (Definition of Done evidence).

Owners:
- `A=PO` for scope and priority.
- `R=EL/PM` for execution fields and status currency.
- `R=QA` for test/readiness evidence quality.

## Mandatory Item Fields

Every active execution item must include:
- Title and short description
- Business value
- Priority (`P0/P1/P2` or severity for bugs)
- Owner
- Estimate
- Dependencies
- Target sprint
- Target release
- Acceptance criteria
- Test/readiness notes
- Current status

## Definition of Ready (DoR)

Item can enter sprint only if:
- Scope and acceptance criteria are clear and testable.
- Owner assigned.
- Estimate assigned.
- Dependencies identified.
- No unresolved blocker remains.

## Definition of Done (DoD)

Item can be marked done only if:
- Implementation merged.
- Relevant lint/build/tests pass.
- User-facing docs/status updated.
- Acceptance criteria validated with evidence link.

## Weekly Hygiene Checklist

1. Remove duplicates and merge overlaps.
2. Archive outdated items or mark explicitly as deferred.
3. Verify all active `P0` items have complete mandatory fields.
4. Re-rank top priorities against current release goal.
5. Confirm dependency chain and blocker ownership.
6. Sync:
   - `EXECUTION_BACKLOG_BOARD.md`
   - `BUG_BACKLOG.md`
   - `AUTONOMOUS_STATUS.md`
   - `phase-progress.md`

## Staleness Rules

- Any active item not updated in 7 days -> mark `Needs Update`.
- Any blocker open for >3 business days -> escalation in weekly governance.
- Any phase KPI off-track for 2 consecutive weeks -> scope/timeline adjustment decision required.
