---
title: Production Deployment Runbook
audience: internal-ops
status: active
last_updated: 2026-05-26
owner: Engineering / DevOps
---

Use this runbook when deploying the Vexa PIM API or Web app to production. Follow it for every production deploy, including hotfixes. Do not skip steps under time pressure — a failed migration is harder to recover from than a delayed deploy.

> **Corrected 2026-09-17:** confirmed directly against the live Railway dashboard — there is currently exactly **one** Railway environment (named "Staging" in Railway, serving `app.vexapim.com`), and it is what "production" means everywhere in this document. The separate `promote-stage3.yml` pipeline this doc's rollback/notification sections implicitly assume has **never executed** (zero GitHub Actions runs, ever, confirmed via `gh run list`) and targets an environment name that doesn't exist in the only accessible Railway project. Every deploy step below happens on the one real environment, triggered by `deploy-staging.yml`. The Web app also runs on **Railway**, not Vercel — § 3B below is corrected accordingly. See `docs/operations/CURRENT_PRODUCTION_ARCHITECTURE.md` for the current live topology.

---

## 1. Pre-Deploy Checklist

Complete before pushing to `main` or triggering a Railway redeploy.

- [ ] All CI checks pass on the branch you are deploying
- [ ] `npm run test:unit --workspace @pim1/api` passes locally
- [ ] `npm run test:integration:rls-isolation` passes
- [ ] If the deploy includes a migration: run `npx prisma migrate status` against staging first — confirm no pending failures
- [ ] If the deploy includes a migration: take a manual backup (see `docs/runbooks/backup-restore.md` § 4)
- [ ] Announce the deploy in the team channel: "Deploying [version/PR] to production at [HH:MM UTC]"
- [ ] Verify no active pilot tenant sessions are open for critical operations (imports, bulk submissions)

---

## 2. Migration Safety

Migrations run as the Railway `preDeployCommand` (`node scripts/prisma-migrate-deploy.cjs`) before the new API version starts.

**If the migration fails:**
- Railway keeps the previous API version running
- The new version does NOT start
- The platform enters a "deploy failed" state — visible in the Railway Deployments tab
- Do NOT force-start the new version over a failed migration — the schema mismatch will corrupt data

**To recover from a failed migration:**
1. Read the migration error in Railway deployment logs
2. Fix the migration in git
3. Re-push to trigger a fresh deploy cycle
4. Do not manually patch the database schema

---

## 3. Deploy Steps

### 3A. API Service (Railway)

```bash
# Option A — Deploy from main branch (standard path)
# Push to main; Railway auto-deploys via the webhook

# Option B — Manual trigger from Railway dashboard
# Railway → Project → API service → Deploy → Trigger deploy

# Option C — Re-deploy a previous version (rollback)
# Railway → Project → API service → Deployments → find last known-good → Re-deploy
```

Railway runs in this order:
1. Build: `npm ci && prisma:generate && build`
2. Pre-deploy: `node scripts/prisma-migrate-deploy.cjs` (migration)
3. Health check: `GET /api/v1/health` with 300-second timeout
4. Start: `node apps/api/dist/main.js`

The deploy is not live until the healthcheck passes.

### 3B. Web App (Railway)

```bash
# Railway auto-deploys the "App Vexa" service from the main branch on every push,
# same as the API service. Confirmed live: Settings → Source → Branch connected: main.

# For a manual trigger: Railway dashboard → Project → App Vexa service → Deploy → Trigger deploy
```

Web deploys do not run database migrations — deploy order does not matter between API and Web.

---

## 4. Post-Deploy Smoke Tests

Run immediately after Railway reports the deploy as healthy.

```bash
# 1. API health
curl https://api.yourvexa.com/api/v1/health
# Expected: {"status":"ok","env":"staging","queueRuntime":{"backend":"bullmq","workerEnabled":true}}
# (env will read "staging" — that's the real environment name; see the note at the top of this
# file. workerEnabled reflects whether QUEUE_WORKER_ENABLED is set on this service — see § 2 below.)

# 2. Worker health
# Corrected 2026-09-17: no separate worker Railway service was found in the live dashboard check —
# only "App Vexa" (web) and "Vexa API" (API) exist. If worker mode runs in-process on the API
# service, its health is already covered by step 1's queueRuntime.workerEnabled field. If a
# dedicated worker service is stood up later, check its own /api/v1/health the same way.

# 3. Post-deploy script
node scripts/staging-postdeploy-check.cjs
# This runs against the one real environment there is — there is no separate
# production URL/variable to point it at (confirmed 2026-09-17; see the note
# at the top of this file). Be aware this script creates and mutates real
# workspace users and a real product on every run — see
# docs/runbooks/test-data-governance.md.

# 4. Auth: log in with the ops admin account and confirm JWT is issued
# 5. Catalog: open any product and confirm it loads
# 6. If migration ran: verify row counts match pre-deploy state
psql "${DATABASE_URL_DIRECT}" -c "SELECT COUNT(*) FROM \"Product\";"
```

---

## 5. Rollback Procedure

Use when: smoke tests fail, error rate spikes, or a migration regression is detected.

```bash
# 1. Go to Railway → Project → API service → Deployments
# 2. Find the last known-good deployment (green status)
# 3. Click Re-deploy on that version

# If the failing deploy introduced a migration that must be reverted:
# 4. Write a compensating migration (DO NOT delete _prisma_migrations rows manually)
# 5. Test the compensating migration against a staging DB clone first
# 6. Deploy the compensating migration as a new deploy cycle
```

**Web rollback:** Railway dashboard → App Vexa service → Deployments → find previous deployment (green status) → Re-deploy.

---

## 6. Notification

| Event | Who to notify | How |
|-------|--------------|-----|
| Deploy started | Team channel | Slack / chat message |
| Deploy successful | Team channel | Confirm message with version |
| Deploy failed | DevOps + CTO | Immediate page if P0; Slack if P1 |
| Rollback initiated | DevOps + CTO | Immediate, include reason |
| Pilot tenant affected | Tenant contact | P0 template in `docs/runbooks/disaster-recovery.md` § 4 |

---

## 7. Environment Variable Changes

If the deploy requires adding or updating environment variables:

1. Update Railway env vars **before** triggering the deploy (Railway restarts the service when vars change)
2. If the new var is required (validated by `env-validation.ts`): the service will refuse to start without it — do not deploy before setting it
3. If the new var is optional: deploy can proceed; service will use the default

See `docs/configuration-reference.md` for all variables and their required/optional status.

---

## 8. Post-Deploy Checklist Sign-off

After every production deploy, record in the deploy log:

- [ ] Health endpoint returned `{"status":"ok"}`
- [ ] Smoke tests passed
- [ ] Row counts match pre-deploy (if migration ran)
- [ ] No error spike in Railway logs in the 10 minutes after deploy
- [ ] Team notified of successful deploy
