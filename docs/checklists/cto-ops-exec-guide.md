# CTO Ops Execution Guide — Pilot Unblock

**Date**: 2026-06-04  
**Owner**: CTO + Ops lead  
**Target completion**: 45 minutes  
**Go/no-go decision**: After items #1–2 pass

---

## Prerequisites (verify NOW)

- [ ] GitHub repo access + Actions permissions
- [ ] Railway dashboard access to PIM project
- [ ] Local dev environment has staging URLs (will be provided by Ops)
- [ ] PR #219 is in final review (code fixes: viewer mode, attributes tab, imports cleanup)

---

## ITEM #1: Rotate Staging Secrets (15 min) — BLOCKING ALL DEPLOYS

### Root Cause
Prisma `P1001` (connection refused) since 2026-05-25. Railway proxy URL changed; GitHub Actions secrets not updated.

### Step-by-step

**A. Get new Railway database URL** (5 min, Ops lead)
1. Open [Railway dashboard](https://railway.app) → PIM project
2. Switch to `staging` environment (top-right env selector)
3. Click `database` service → Connect tab
4. Copy **Internal URL** (e.g., `postgresql://user:pass@internal-db.railway.internal:5432/pim`)
5. Ops: **Share with CTO immediately** — do NOT share in chat, use 1:1 secure channel

**B. Update GitHub Actions staging environment config** (5-10 min, CTO)
1. Go to [GitHub repo](https://github.com/Vexapim/PIM) → Settings → Secrets and variables → Actions
2. Click **Environment: staging**
3. Verify **deployment protection rules** first:
   - `Required reviewers` should be disabled if merged PRs are expected to deploy staging automatically.
   - If approvals are intentionally required, the team should treat staging deploys as manual-gated, not fully automatic.
4. Update these baseline secrets:
   - `STAGING_DATABASE_URL` = Railway internal URL from step A
   - `STAGING_DATABASE_URL_DIRECT` = Same URL (used for migrations)
   - `STAGING_BASE_URL` = Railway API service public root URL (not `/api/v1`)
   - `STAGING_WEB_URL` = Railway web service public root URL
5. Verify the full staging workflow secret contract also exists:
   - Railway deploy/auth:
     - `RAILWAY_TOKEN` or `RAILWAY_API_TOKEN`
     - `RAILWAY_PROJECT_ID`
     - `RAILWAY_ENVIRONMENT_ID`
     - `RAILWAY_API_SERVICE` or `RAILWAY_API_SERVICE_ID`
     - `RAILWAY_WEB_SERVICE` or `RAILWAY_WEB_SERVICE_ID`
   - Post-deploy and nightly smoke:
     - `STAGING_SMOKE_WORKSPACE`
     - `STAGING_SMOKE_USER`
     - `STAGING_SMOKE_PASSWORD`
     - `STAGING_SMOKE_TENANT_ID`
     - `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED`
   - Optional connector E2E coverage:
     - `STAGING_AMAZON_SELLER_ID`
     - `STAGING_AMAZON_CLIENT_ID`
     - `STAGING_AMAZON_CLIENT_SECRET`
     - `STAGING_AMAZON_REFRESH_TOKEN`
6. ✅ Save each

**C. Verify the automatic lane or trigger manually** (5 min, CTO)
1. Go to GitHub → Actions tab → `deploy-staging.yml`
2. If a PR was just merged to `main`, confirm a new run started automatically.
3. If no run started, re-check the `staging` environment protection rules and required secrets above.
4. If needed, click "Run workflow" → branch: `main` → **Run**
5. Watch the run in real-time
   - Expected: compile → migrations → app starts
   - If P1001: secret is still wrong, fix immediately

**Verification**
```bash
# After deploy shows ✅ :
curl -s https://pim-web-staging.up.railway.app/health | jq .
# Expected: { "status": "ok" }
```

**Decision gate**: ITEM #1 PASSED ✅ only if:
- [ ] Deploy workflow shows green
- [ ] A merge to `main` starts `deploy-staging.yml` automatically when staging approvals are not required
- [ ] No Prisma P1001 in logs
- [ ] `/health` endpoint responds with 200

---

## ITEM #2: Run Smoke Tests (30 min) — VERIFY STAGING IS USABLE

### Prerequisites
- [ ] ITEM #1 passed (staging is deployed and healthy)

### Step-by-step

**A. Trigger E2E smoke suite** (2 min, QA lead)
1. Go to GitHub → Actions → `e2e-staging.yml`
2. Click "Run workflow" → branch: `main` → target: `staging` → **Run**
3. Watch for real-time updates in Discord #vexa-eng or Slack

**Alternative (if you want faster feedback locally)**:
```bash
# Requires playwright installed
export PLAYWRIGHT_BASE_URL=https://pim-web-staging.up.railway.app
export PLAYWRIGHT_API_URL=https://pim-api-staging.up.railway.app/api/v1
npm run test:e2e:smoke
```

**B. Verify test results** (15 min)
- Expected: 6 journeys pass (product CRUD, billing, imports, audit)
- RBAC isolation verified: viewer/editor/admin role separation correct
- Error handling: grace period, invalid input, 403 responses all correct

**C. Record baseline** (5 min, DevOps)
```bash
export RAILWAY_TOKEN=<your-railway-token>
node scripts/performance-baseline.cjs --env staging
```
Output: stored in `docs/execution/CURRENT_STATE.md` as:
```
gate:run:sprint: PASSED 2026-06-04
performance:baseline: recorded 2026-06-04
```

**Decision gate**: ITEM #2 PASSED ✅ only if:
- [ ] E2E smoke suite shows all green (6/6 journeys)
- [ ] RBAC isolation tests pass
- [ ] Performance baseline recorded
- [ ] No flaky timeouts in playwright runs

---

## Post-completion: PILOT GO/NO-GO

Once both items pass:

| Component | Status | Notes |
|-----------|--------|-------|
| Code (PR #219) | 🟢 Ready | Viewer mode, attributes tab, dead code cleanup |
| Staging deploy (Item #1) | 🟢 Ready | DB secrets rotated, health check passes |
| Smoke tests (Item #2) | 🟢 Ready | 6 journeys + RBAC verified |
| **Pilot readiness** | **🟢 GO** | All gates clear |

**Next**: Deploy PR #219 to staging → onboard first pilot tenant → monitor for 24h → full rollout.

---

## Troubleshooting

### Deploy fails with P1001
**Action**: Secret is incorrect.
1. Verify Railway internal URL was copied fully (no truncation)
2. Test locally: `psql <URL>` to confirm connectivity
3. Re-check baseline staging secrets in GitHub Actions environment match exactly

### PR merged but no staging deploy started
**Action**: GitHub environment configuration is blocking the automatic lane.
1. Open GitHub → Settings → Environments → `staging`
2. Check whether `Required reviewers` is enabled
3. If automatic post-merge deploys are intended, disable required reviewers for staging
4. Re-check that `deploy-staging.yml` is still triggered on `push` to `main`
5. Confirm all required staging secrets exist; GitHub can suppress or fail runs when environment-scoped secrets are missing

### E2E smoke tests fail/timeout
**Action**: Staging app may be unhealthy.
1. Check `/health` endpoint
2. Check Railway logs for errors (database, Redis, API)
3. Verify env vars in Railway (stripe keys, encryption keys) are set
4. Restart Railway web service if needed

### Performance baseline fails
**Action**: Script may be missing dependencies.
1. Ensure `scripts/performance-baseline.cjs` exists
2. Run: `node scripts/performance-baseline.cjs --help`
3. If missing, create minimal version or skip until Phase 2

---

## Timeline tracking

| Phase | Owner | Est. time | Start | End | Status |
|-------|-------|-----------|-------|-----|--------|
| Get Railway URL | Ops | 5 min | — | — | ⏳ Pending |
| Update secrets | CTO | 5 min | — | — | ⏳ Pending |
| Trigger deploy | CTO | 5 min | — | — | ⏳ Pending |
| Verify /health | CTO | 2 min | — | — | ⏳ Pending |
| **ITEM #1 decision** | **CTO** | — | — | — | ⏳ **Pending** |
| Trigger smoke suite | QA | 2 min | — | — | ⏳ Pending |
| Monitor tests | QA | 15 min | — | — | ⏳ Pending |
| Record baseline | DevOps | 5 min | — | — | ⏳ Pending |
| **ITEM #2 decision** | **QA** | — | — | — | ⏳ **Pending** |
| **Pilot GO decision** | **CTO + PO** | — | — | — | ⏳ **Pending** |

---

## Critical success factors

✅ **ITEM #1 must pass before ITEM #2** (item #2 depends on healthy staging)  
✅ **Secrets must be kept secure** — use 1:1 channels, not shared Slack  
✅ **Deploy logs must show no P1001** — if present, database is not accessible  
✅ **Smoke tests must not be skipped** — they validate RBAC separation and data integrity  
✅ **Baseline must be recorded** — drift detection depends on it  

---

## Sign-off

When both items pass, update this section:

- [ ] CTO sign-off: staging is healthy, app responds, no P1001
- [ ] QA sign-off: all 6 E2E journeys pass, RBAC verified, baseline recorded
- [ ] PO sign-off: ready to onboard first pilot tenant
- [ ] Go-live timestamp: `2026-06-04 HH:MM UTC`
