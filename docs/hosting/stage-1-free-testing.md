---
title: Stage 1 — Free Testing Runbook
audience: internal-ops
status: active
last_updated: 2026-05-17
owner: Engineering
---

# Stage 1 — Free Testing

**Cost:** ₹0/month  
**Purpose:** Internal development, CI baseline, early integration smoke tests  
**Workflow:** [deploy-stage1.yml](../../.github/workflows/deploy-stage1.yml)

## 1. Services

| Service | Provider | Tier | Notes |
|---------|----------|------|-------|
| API | Render | Free (512 MB, sleeps after 15 min inactivity) | Spins up on first request |
| Web | Vercel | Hobby (free) | Edge-optimized Next.js |
| Database | Neon | Free (0.5 GB, 1 compute unit) | Serverless Postgres |
| Redis | Upstash | Free (10,000 requests/day) | Auth + BullMQ |
| Object Storage | Cloudflare R2 | Free tier (10 GB) | Product images |

## 2. What to disable at Stage 1

- Queue worker: set `FEATURE_WORKER_ENABLED=false` — use in-process fallback only
- Heavy imports: set `FEATURE_BULK_IMPORT_ENABLED=false` or limit to 50-row batches
- Public signup: set `FEATURE_PUBLIC_SIGNUP_ENABLED=false`
- ONDC: set `FEATURE_ONDC_ENABLED=false`
- Real SP-API validation: set `FEATURE_REAL_SPAPI_VALIDATION=false`

## 3. Weekly timeline

| Day | Action |
|-----|--------|
| Mon | Confirm Neon free compute has not been paused (open dashboard) |
| Wed | Trigger `deploy-stage1` workflow; confirm smoke test passes |
| Fri | Run `npm run hosting:stage1:verify` locally against Stage 1 URL |

## 4. Deploy checklist

- [ ] Copy `.env-templates/.env.stage1.example` → `.env`, fill real secrets
- [ ] Apply migrations: `npm run prisma:migrate:deploy`
- [ ] Seed demo data if needed: `npm run auth:bootstrap-admin`
- [ ] Push to `main` or trigger `deploy-stage1` workflow via GitHub Actions
- [ ] Confirm `/api/v1/health` returns `{"status":"ok","env":"staging"}`
- [ ] Run `npm run hosting:stage1:verify`

## 5. Exit gate — promote to Stage 2

All of the following must be true before promoting:

- [ ] CI passes on `main` (build + integration tests)
- [ ] `hosting:stage1:verify` exits 0 three consecutive times
- [ ] No P0/P1 open issues
- [ ] Core user journey (login → create product → simulate export) completes without errors

Promote by deploying to paid services per the [Stage 2 runbook](stage-2-investor-demo.md).
