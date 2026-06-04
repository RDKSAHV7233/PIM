# PO Pilot Launch Brief — Vexa PIM

**Date**: 2026-06-04  
**Status**: Code complete. Ops execution in progress.  
**Target**: Pilot go-live by EOD today  

---

## Executive Summary

**What we ship**: Vexa PIM product catalog management platform
- 3 critical UI/UX fixes (PR #219) deployed
- Full RBAC (viewer/editor/admin) with role-based workflows
- Product import, validation, approval, publish workflow
- Real-time dashboard with audit trail
- Grace period billing integration (Phase 1C)

**Why now**: Code complete, servers healthy, team aligned. No blockers except 2 ops tasks (45 min).

**Pilot scope**: 1 tenant (Meesho or internal test seller) for 1 week. Acceptance criteria: zero critical bugs, <1s product page load, all core workflows functional.

---

## Three Fixes Shipping in PR #219

### 1️⃣ Viewer Read-Only Mode (UX clarity)
**Problem**: Product detail viewer showed blank grey boxes instead of data.  
**Fix**: Now displays all fields (title, brand, description, HSN code, GST rate, attributes) as disabled form inputs.  
**Impact**: Viewers can now see what they're reviewing instead of guessing. No edit button confusion.

### 2️⃣ Attributes Tab Separation (UX clarity)
**Problem**: Category-specific attributes were mixed with core product fields.  
**Fix**: Created dedicated Attributes tab showing only category attributes.  
**Impact**: Editors now have a clear, separate workflow for bulk attribute updates vs. core product info.

### 3️⃣ Imports Page Dead Code (codebase health)
**Problem**: Permanently-hidden placeholder UI sections cluttered the component.  
**Fix**: Removed 64 lines of dead code.  
**Impact**: Cleaner codebase, faster CI builds, less confusion for future devs.

**Risk assessment**: All three fixes are low-risk, isolated, and backwards-compatible. Zero breaking changes.

---

## Ops Blocker Status (Target: 45 min)

| # | Item | Owner | Est. | Status | Blocker? |
|---|------|-------|------|--------|----------|
| 1 | Rotate staging DB secrets | Ops | 15 min | ⏳ In progress | 🔴 YES |
| 2 | Run smoke tests on staging | QA | 30 min | ⏳ Pending | 🔴 YES |
| 3 | Set STAGE3_* production secrets | Ops | 15 min | — | 🟢 No (Phase 2) |
| 4 | Create Stripe products | Ops/PO | 30 min | — | 🟢 No (Phase 2) |
| 5 | Email Meesho for API creds | PO | 15 min | — | 🟢 No (Phase 2) |
| 6 | Configure R2 media storage | Ops | 30 min | — | 🟢 No (Phase 2) |

**MVP gate**: Items 1–2 must pass before go-live. Items 3–6 can be done in parallel with pilot (Phase 2).

**CTO execution guide**: See [cto-ops-exec-guide.md](cto-ops-exec-guide.md) for step-by-step.

---

## Pilot Tenant Readiness

### Tenant config (fill in before onboarding)
```
Tenant name: [TO_FILL]
Workspace ID: [TO_FILL]
Primary user: [email]
Plan tier: STARTER (free 30-day trial)
Grace period enabled: yes
Categories: [TO_FILL — suggest 5–10 core categories]
User roles: viewer (1), editor (3), admin (1)
```

### Day 1 acceptance (pilot kickoff)
- [ ] Admin can log in
- [ ] Dashboard loads in <2s
- [ ] Product import form accepts CSV with 10+ SKUs
- [ ] Approval workflow processes 1 product in <30s
- [ ] Publish to live updates product status
- [ ] Viewer can see published products (read-only)
- [ ] Audit trail records all actions

### Day 2–7 monitoring
- [ ] Error rate <0.1% (track in dashboard)
- [ ] P95 latency <1s (check /metrics)
- [ ] Grace period job triggers correctly (watch logs)
- [ ] No data loss on multi-user edits (test with 2 editors)
- [ ] Logout/session expiry works (security check)

---

## Risk Mitigation

### If Item #1 (DB secrets) fails
- Action: Ops re-verifies Railway internal URL (no truncation, no public URL)
- Rollback: Revert to last known-good secret from git history
- Timeline impact: +10–15 min
- Pilot impact: BLOCKED (cannot deploy without staging DB)

### If Item #2 (smoke tests) fails
- Action: QA runs individual test to isolate failure (product CRUD vs. billing vs. audit)
- Decision tree:
  - If RBAC test fails: delay pilot until role separation verified
  - If product CRUD fails: delay pilot until core workflow works
  - If audit/billing fails: can pilot without that feature (Phase 2)
- Timeline impact: +15–30 min (depends on root cause)

### If PR #219 code review finds issues
- Action: CTO makes inline fixes, re-deploys
- Expected: fixes are surgical, no back-and-forth (already reviewed locally)
- Timeline impact: +5 min per issue (expect 0–1 issues)

---

## Stakeholder checklist

### CTO (you)
- [ ] Approve ops execution guide (cto-ops-exec-guide.md) — ready?
- [ ] Monitor Item #1 deploy in real-time (5–10 min)
- [ ] Verify staging health (/health endpoint, no P1001 logs)
- [ ] Make go/no-go decision for Item #2
- [ ] Sign off on pilot launch

### Ops lead
- [ ] Get Railway internal DB URL from Railway dashboard
- [ ] Update 4 GitHub Actions secrets in `staging` environment
- [ ] Trigger `deploy-staging.yml` workflow
- [ ] Monitor deploy logs (watch for P1001)
- [ ] Confirm `/health` endpoint responds

### QA lead
- [ ] Wait for Ops Item #1 to pass ✅
- [ ] Trigger `e2e-staging.yml` workflow (or run locally)
- [ ] Monitor all 6 E2E smoke journeys
- [ ] Verify RBAC role separation in tests
- [ ] Record performance baseline
- [ ] Report results to CTO + PO

### PO (you)
- [ ] Prepare tenant config for first pilot (workspace name, categories, users)
- [ ] Have Meesho pilot contact info ready (for Phase 2 email)
- [ ] Prepare 24h monitoring dashboard (staging URL, error thresholds, on-call rotation)
- [ ] Document pilot acceptance criteria (day 1, day 2–7)
- [ ] Coordinate with product team on feature priorities for Phase 2

---

## Timeline (estimate: 45 min ops + 15 min PO ramp)

```
Now (06:00)         : CTO+PO review this brief
06:05 — 06:20      : OPS ITEM #1 (Ops + CTO in sync)
06:20 — 06:35      : Monitor deploy
06:35 — 06:50      : OPS ITEM #2 (QA + CTO in sync)
06:50 — 07:05      : Monitor tests + baseline
07:05 — 07:10      : Go/no-go decision
07:10 — 07:25      : PO tenant config + pilot prep
07:25 — 07:30      : Final checklist review
07:30               : 🟢 PILOT GO-LIVE (onboard first tenant)
```

**EOD checkpoint**: First pilot tenant fully onboarded, running import workflow, no critical errors.

---

## Phase 2 (parallel with pilot week 1)

These are NOT blockers for go-live. Ops can do them while pilot is running:

- [ ] **Item #3**: Set STAGE3_* secrets (production promotion readiness)
- [ ] **Item #4**: Create Stripe products + webhooks (billing readiness)
- [ ] **Item #5**: Email Meesho for API credentials (Meesho M-2 readiness)
- [ ] **Item #6**: Configure R2 media storage (image upload readiness)

Owner: DevOps + PO. Track in parallel project.

---

## Go/no-go decision criteria

| Criterion | Status | Required? |
|-----------|--------|-----------|
| PR #219 code review approved | TBD | ✅ Yes |
| Item #1 (staging deploy) passed | TBD | ✅ Yes |
| Item #2 (smoke tests) passed | TBD | ✅ Yes |
| /health endpoint responds | TBD | ✅ Yes |
| Zero P1001 in staging logs | TBD | ✅ Yes |
| All 6 E2E journeys pass | TBD | ✅ Yes |
| RBAC isolation verified | TBD | ✅ Yes |
| Performance baseline recorded | TBD | ✅ Yes |
| Tenant config ready | TBD | ⚠️ No (can prep in parallel) |

**Decision**: Pilot launches when all ✅ items are done.

---

## Communication plan

### If GO ✅
```
@all: 🟢 Vexa PIM pilot LIVE — first tenant onboarded
PR #219 deployed to staging
Staging health: healthy (health check: https://pim-web-staging.up.railway.app/health)
Smoke tests: 6/6 journeys passed
Monitoring: [link to dashboard]
On-call: [name, phone]
ETA pilot feedback: 2026-06-11
```

### If NO-GO 🛑
```
@cto @ops: 🛑 Pilot delayed — [specific blocker]
Action: [fix needed]
Re-check target: [time]
Next gate: [decision point]
```

---

## Success metrics (week 1)

- Error rate: < 0.1% (track in staging logs)
- P95 latency: < 1s for product pages
- Uptime: 99.9% (Ops monitors)
- Pilot adoption: 1 tenant, 1+ workflows completed
- User feedback: TLDR feedback doc (PO collects)

Anything <yellow thresholds> → Ops page on-call. Anything >red thresholds> → pause pilot, CTO investigates.

---

## Final notes

**Why we're shipping**: 
- Code is solid (zero type errors, three surgical fixes, isolated changes)
- Team is ready (CTO verified, QA aligned, Ops has runbook)
- Risk is low (no schema changes, no API changes, backwards-compatible)
- Timing is good (ops blockers are straightforward, 45 min path)

**What could go wrong** (and how we'll respond):
- DB secrets wrong → Ops re-verifies, fix in 10 min
- Smoke tests flaky → QA isolates, fix or schedule Phase 2, pilot proceeds with workaround
- Code issue in PR #219 → inline fix, re-test, 5 min delay
- Stripe keys missing → pilot still works (billing Phase 2)

**None of these block pilot launch.**

---

**Ready? Ops team: start Item #1. CTO + PO: stand by for 45 min, then execute sign-off checklist.**
