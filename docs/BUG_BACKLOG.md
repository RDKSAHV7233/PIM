# Bug Backlog

Purpose:
- Central bug tracking list for defects that affect MVP delivery, quality, or team velocity.

Severity:
- `S1`: production blocker / gate blocker
- `S2`: major functional degradation
- `S3`: minor issue or UX defect

Status:
- `Open`, `In Progress`, `Blocked`, `Resolved`, `Closed`

## Active Bugs

| Bug ID | Severity | Title | Impact | Status | Owner | Dependency | Target Sprint | Validation |
|---|---|---|---|---|---|---|---|---|
| BUG-WEB-001 | S2 | Next dev runtime missing module after stale `.next` artifacts | Causes local 500s and slows delivery/debug cycles | In Progress | EL | None | S4-CLOSEOUT-1 | Restart runbook + clean boot verification |
| BUG-WEB-002 | S3 | Hydration warning from extension-injected submit attrs | Noise during local QA and demo sessions | Resolved | EL | None | S4-CLOSEOUT-1 | `suppressHydrationWarning` patch validated |
| BUG-OPS-001 | S3 | Multiple web processes binding port 3000 | Non-deterministic startup and false failures | In Progress | EL | BUG-WEB-001 | S4-CLOSEOUT-1 | Port/process guard procedure documented |

## Triage Rules

- Any `S1` enters current sprint immediately and blocks release.
- Any bug touching a `P0` workflow is prioritized over `P1` feature work.
- Bug closure requires:
  - Repro steps
  - Root cause note
  - Validation evidence
