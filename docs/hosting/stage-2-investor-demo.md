---
title: Stage 2 — Investor Demo Runbook
audience: internal-ops
status: active
last_updated: 2026-05-17
owner: Engineering
---

# Stage 2 — Investor Demo

**Cost:** ₹3,000–5,000/month  
**Purpose:** Customer-facing demo, investor walkthrough, always-on availability  
**Workflow:** [promote-stage2.yml](../../.github/workflows/promote-stage2.yml)

## 1. Services

| Service | Provider | Tier | Notes |
|---------|----------|------|-------|
| API | Render/Railway | Paid starter (1 vCPU, 1 GB RAM, no sleep) | Always-on |
| Web | Vercel | Pro | Custom domain, analytics |
| Database | Neon | Launch ($19/month, 10 GB) | Autoscaling compute |
| Redis | Upstash | Pay-as-you-go (~$5–10/month) | 100K requests/day |
| Object Storage | Cloudflare R2 | Free tier or pay-as-you-go | Product images |

## 2. What to enable at Stage 2

- Queue worker: set `FEATURE_WORKER_ENABLED=true`
- Enable public signup if demo flow requires it: `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
- Marketplace connectors: configure at least Shopify and Flipkart client IDs/secrets

## 3. Pre-investor checklist

Run the `promote-stage2` workflow or execute locally:

```bash
STAGING_URL=https://your-stage2-api.example.com npm run hosting:stage2:verify
```

The script asserts:
1. `/api/v1/health` → `{"status":"ok"}` with correct env
2. Login endpoint accepts valid credentials
3. Catalog endpoint returns at least one product
4. Worker ping responds (queue worker enabled)

## 4. Deploy checklist

- [ ] Copy `.env-templates/.env.stage2.example` → `.env`, fill real secrets
- [ ] Confirm Neon Launch plan is active (check Neon dashboard)
- [ ] Apply migrations: `npm run prisma:migrate:deploy`
- [ ] Deploy API: Railway → staging environment → deploy
- [ ] Deploy Web: `vercel --prod`
- [ ] Configure custom domain and SSL
- [ ] Trigger `promote-stage2` workflow with `STAGING_URL` input
- [ ] Run 15-step Chrome walkthrough (see Shopify connector guide)

## 5. Exit gate — promote to Stage 3

All of the following must be true before promoting:

- [ ] `promote-stage2` workflow exits 0
- [ ] 15-step Chrome proof recorded (screen capture or Loom)
- [ ] At least one real connector (Shopify or Flipkart) has completed an export cycle end-to-end
- [ ] P0 and P1 issue backlog is empty
- [ ] Database backup tested: export from Neon, restore to local Postgres, confirm product count

Promote by upgrading to production-grade services per the [Stage 3 runbook](stage-3-pilot-ready.md).
