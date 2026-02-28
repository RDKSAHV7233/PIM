# Operating Model

## Purpose
Provide a lightweight operating system to execute phases with speed and control.

## Cadence
- Daily: 15-minute standup
- Weekly: phase progress review (60 minutes)
- Sprint end (biweekly): demo + retro + backlog re-prioritization
- Phase end: gate review and go/no-go decision

## Ceremonies
1. Daily Standup
- Yesterday done
- Today plan
- Blockers

1. Backlog Hygiene Review (weekly, before governance)
- Validate mandatory fields for active items
- Re-rank `P0` items against release goals
- Resolve duplicates, stale items, and ownership gaps
- Sync execution board and bug backlog

2. Weekly Governance
- KPI review against phase targets
- Risk register updates
- Decision log updates

3. Phase Gate Review
- Exit criteria evidence walkthrough
- Technical debt review
- Scope and timeline adjustment decision

## Decision Rights
- Product scope: Product Owner
- Technical architecture: Engineering Lead
- Release and quality gates: Engineering Lead + QA Owner
- Pricing and packaging: Founder/GTM Owner

## Artifacts to Keep Current
- `AUTONOMOUS_STATUS.md`
- `KPI_DASHBOARD_TEMPLATE.md`
- `RACI.md`
- `EXECUTION_BACKLOG_BOARD.md`
- `SPRINT_PLAN_PHASE4_CLOSEOUT.md`
- `BUG_BACKLOG.md`
- `BACKLOG_HYGIENE.md`
- Phase-specific deliverables and release notes

## Escalation Rules
- Any phase KPI off-track by >20% for 2 consecutive weeks -> escalation.
- Any unresolved blocker >3 business days -> escalation.
- Any legal/compliance uncertainty affecting release -> stop and resolve before gate.
