# PIM1 First Seller Onboarding Playbook

## Purpose
Provide a repeatable onboarding flow for the first pilot sellers (India-first, 500-5,000 SKUs, catalog teams of 2-10) with explicit success/fail gates.

## Owner Roles
- `PO`: owns pilot recruitment, call schedule, business sign-off.
- `CTO/Engineering Lead`: owns technical readiness, incident handling, gate evidence.
- `Onboarding Operator`: runs live session and captures friction notes.

## Entry Criteria (must be true before onboarding starts)
- Auth trust boundary hardening is live (no client-set tenant/role authority).
- Tenant isolation tests pass with zero cross-tenant leakage.
- Queue failure visibility is live (failed/dead-letter and reason visible).
- Media SSRF protections are enabled.
- Bulk edit empty-scope guard is enabled.
- Current staging/production build is green for:
  - `test:integration:auth-revocation`
  - `test:integration:rls-isolation`
  - `test:integration:worker-backpressure`
  - `test:integration:media-ssrf-guard`
  - `test:integration:bulk-edit-empty-scope`
  - `test:integration:connector-idempotency-semantics`

## Pilot Seller Profile (strict)
- Category focus: apparel/home/lifestyle SKUs with moderate attribute depth.
- SKU volume: 500-5,000 total active catalog items.
- Team shape: 2-10 members with at least one catalog operator.
- Channel target: at least one active marketplace goal in the next 30 days.
- Data source readiness: can provide CSV/XLSX with title, brand, category, HSN/GST baseline.

## Session Flow (120 minutes)
1. `00-15 min` Kickoff and access check
   - Confirm login, role, tenant assignment.
   - Confirm no test-data confusion in primary views.
2. `15-45 min` First import
   - Upload source file.
   - Verify row-level success/failure and visible repair loop.
3. `45-75 min` Quality pass
   - Open Products tab, inspect compliance/channel readiness.
   - Fix top blocking issues from list view + product detail.
4. `75-95 min` Bulk operations
   - Preview bulk edit with non-empty scoped filter.
   - Confirm diff, apply, verify history.
5. `95-115 min` Connector value proof path
   - Run one publish/export job for installed connector capability.
   - Verify submission status and failure reason visibility if any.
6. `115-120 min` Closeout and next-session commitment
   - Capture unresolved blockers.
   - Book follow-up date within 7 days.

## Evidence to Capture
- Tenant ID, user ID, session date/time.
- Import job IDs and counts (total/success/failed).
- Submission job IDs and terminal states.
- Top 5 friction points (time-stamped).
- Any failed actions with reason text shown to seller.

## Exit Gates
- Seller completes first import without engineering intervention.
- Seller reaches visible issue list and resolves at least one blocker.
- Seller completes at least one successful scoped bulk edit.
- Seller observes one connector submission/export outcome in history.
- Follow-up session is booked within 7 days.

## Escalation Rules
- `P0 incident`: stop onboarding immediately; rollback or hotfix before continuing.
- `P1 issue`: continue session with workaround, open tracked bug before EOD.
- `P2 issue`: log for sprint planning, do not block pilot flow.

## Weekly Pilot KPI Snapshot
- Time to first successful import (target: <= 30 min).
- Session completion rate (target: >= 80%).
- 7-day return rate (target: >= 60%).
- Number of blockers per session (target trending down week-over-week).

